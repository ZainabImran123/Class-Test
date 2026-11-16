import notificationModel from "../models/notifications.model.js"
import userModel from "../models/users.model.js"

async function createNotifications(recipientIds, notification) {
    const recipients = [...new Set(recipientIds.filter(Boolean).map(id => id.toString()))]
    if (!recipients.length) return

    await notificationModel.insertMany(recipients.map(recipient => ({
        ...notification,
        recipient
    })))
}

async function notifyAdmins(notification) {
    const admins = await userModel.find({ role: "admin", isActive: { $ne: false } }).select("_id")
    await createNotifications(admins.map(admin => admin._id), notification)
}

async function notifyPatientRegistered(patient) {
    await notifyAdmins({
        type: "patient_registered",
        title: "New patient registered",
        message: `${patient.name || patient.username} created a patient account.`
    })
}

async function notifyAppointmentBooked(appointment) {
    const patientName = appointment.patient?.name || appointment.patient?.username || "A patient"
    const doctorName = appointment.doctor?.name || appointment.doctor?.username || "a doctor"
    const details = `${new Date(appointment.appointmentDate).toISOString().slice(0, 10)} at ${appointment.appointmentTime}`
    const notification = {
        type: "appointment_booked",
        title: "New appointment request",
        message: `${patientName} requested an appointment with Dr. ${doctorName} for ${details}.`,
        appointment: appointment._id,
        status: appointment.status
    }
    await Promise.all([
        createNotifications([appointment.doctor?._id], notification),
        notifyAdmins(notification)
    ])
}

async function notifyAppointmentStatusChanged(appointment, actorRole) {
    const patientName = appointment.patient?.name || appointment.patient?.username || "The patient"
    const doctorName = appointment.doctor?.name || appointment.doctor?.username || "the doctor"
    const statusText = appointment.status === "approved"
        ? "confirmed"
        : appointment.status === "rejected" ? "declined" : "cancelled"
    const details = `${new Date(appointment.appointmentDate).toISOString().slice(0, 10)} at ${appointment.appointmentTime}`
    const notification = {
        type: "appointment_status",
        title: `Appointment ${statusText}`,
        message: `The appointment for ${patientName} with Dr. ${doctorName} on ${details} was ${statusText}.`,
        appointment: appointment._id,
        status: appointment.status
    }
    const recipients = actorRole === "doctor"
        ? [appointment.patient?._id]
        : actorRole === "patient"
            ? [appointment.doctor?._id]
            : [appointment.patient?._id, appointment.doctor?._id]

    await Promise.all([
        createNotifications(recipients, notification),
        notifyAdmins(notification)
    ])
}

export {
    notifyPatientRegistered,
    notifyAppointmentBooked,
    notifyAppointmentStatusChanged
}
