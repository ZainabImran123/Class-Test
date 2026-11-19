import bcrypt from "bcryptjs"
import appointmentModel from "../models/appointments.model.js"
import userModel from "../models/users.model.js"
import { publicUser } from "./auth.controller.js"
import {
    notifyAppointmentBooked,
    notifyAppointmentStatusChanged
} from "../services/notification.service.js"

const populatedAppointment = [
    { path: "patient", select: "name username email" },
    { path: "doctor", select: "name username email specialization experience profilePicture" }
]

function validImageUrl(value) {
    if (!value) return true
    try {
        const url = new URL(value)
        return url.protocol === "https:" || url.protocol === "http:"
    } catch {
        return false
    }
}

function userSummary(user) {
    return {
        ...publicUser(user),
        createdAt: user.createdAt
    }
}

async function listDoctors(req, res) {
    try {
        const search = typeof req.query.search === "string" ? req.query.search.trim() : ""
        const specialization = typeof req.query.specialization === "string" ? req.query.specialization.trim() : ""
        const filter = { role: "doctor", isActive: { $ne: false } }
        if (search) {
            const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
            const pattern = new RegExp(escaped, "i")
            filter.$or = [{ name: pattern }, { username: pattern }, { specialization: pattern }]
        }
        if (specialization) {
            const escaped = specialization.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
            filter.specialization = new RegExp(`^${escaped}$`, "i")
        }
        const [doctors, specializations] = await Promise.all([
            userModel.find(filter)
                .select("name username email specialization experience profilePicture")
                .sort({ name: 1 }),
            userModel.distinct("specialization", { role: "doctor", isActive: { $ne: false } })
        ])
        return res.json({ doctors, specializations: specializations.filter(Boolean).sort() })
    } catch (error) {
        console.error("Could not list doctors:", error)
        return res.status(500).json({ message: "Could not load doctors" })
    }
}

async function getDoctorById(req, res) {
    try {
        const doctor = await userModel.findOne({
            _id: req.params.id,
            role: "doctor",
            isActive: { $ne: false }
        }).select("name username email specialization experience profilePicture")
        if (!doctor) {
            return res.status(404).json({ message: "Doctor not found" })
        }
        return res.json({ doctor })
    } catch (error) {
        if (error.name === "CastError") {
            return res.status(404).json({ message: "Doctor not found" })
        }
        console.error("Could not load doctor details:", error)
        return res.status(500).json({ message: "Could not load doctor details" })
    }
}

async function bookAppointment(req, res) {
    try {
        const { doctorId, appointmentDate, appointmentTime, reason } = req.body ?? {}
        const timezoneOffsetMinutes = req.body?.timezoneOffsetMinutes ?? 0
        if (typeof doctorId !== "string" || typeof appointmentDate !== "string"
            || typeof appointmentTime !== "string" || typeof reason !== "string"
            || !reason.trim() || reason.trim().length > 1000
            || !/^([01]\d|2[0-3]):[0-5]\d$/.test(appointmentTime)
            || !Number.isInteger(timezoneOffsetMinutes) || Math.abs(timezoneOffsetMinutes) > 840) {
            return res.status(400).json({ message: "Choose a doctor, valid date and time, and provide a reason of up to 1000 characters" })
        }
        const date = new Date(`${appointmentDate}T00:00:00.000Z`)
        const now = new Date()
        const [year, month, day] = appointmentDate.split("-").map(Number)
        const [hours, minutes] = appointmentTime.split(":").map(Number)
        const requestedAt = new Date(Date.UTC(year, month - 1, day, hours, minutes) + timezoneOffsetMinutes * 60_000)
        if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== appointmentDate
            || Number.isNaN(requestedAt.getTime()) || requestedAt <= now) {
            return res.status(400).json({ message: "Appointment date and time must be in the future" })
        }
        const doctor = await userModel.findOne({
            _id: doctorId,
            role: "doctor",
            isActive: { $ne: false }
        })
        if (!doctor) {
            return res.status(404).json({ message: "That doctor is unavailable" })
        }
        const conflict = await appointmentModel.exists({
            doctor: doctor._id,
            appointmentDate: date,
            appointmentTime,
            status: { $in: ["pending", "approved"] }
        })
        if (conflict) {
            return res.status(409).json({ message: "That time is already requested. Please choose another time." })
        }
        const appointment = await appointmentModel.create({
            patient: req.user._id,
            doctor: doctor._id,
            appointmentDate: date,
            appointmentTime,
            activeSlotKey: `${doctor._id}:${appointmentDate}:${appointmentTime}`,
            reason: reason.trim()
        })
        await appointment.populate(populatedAppointment)
        await notifyAppointmentBooked(appointment)
        return res.status(201).json({ appointment })
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ message: "That time is already requested. Please choose another time." })
        }
        console.error("Could not book appointment:", error)
        return res.status(500).json({ message: "Could not book appointment" })
    }
}

async function listPatientAppointments(req, res) {
    try {
        const appointments = await appointmentModel.find({ patient: req.user._id })
            .populate(populatedAppointment)
            .sort({ appointmentDate: -1, appointmentTime: -1 })
        const notifications = appointments
            .filter(appointment => ["approved", "rejected", "cancelled"].includes(appointment.status) && !appointment.patientNotifiedAt)
            .map(appointment => ({
                appointmentId: appointment._id,
                status: appointment.status,
                appointmentDate: appointment.appointmentDate,
                appointmentTime: appointment.appointmentTime,
                doctorName: appointment.doctor?.name || appointment.doctor?.username || "Your doctor",
                message: `Your appointment with Dr. ${appointment.doctor?.name || appointment.doctor?.username || "your doctor"} was ${appointment.status}.`
            }))
        return res.json({ appointments, notifications })
    } catch (error) {
        console.error("Could not load patient appointments:", error)
        return res.status(500).json({ message: "Could not load appointments" })
    }
}

async function cancelPatientAppointment(req, res) {
    try {
        const appointment = await appointmentModel.findOneAndUpdate(
            { _id: req.params.id, patient: req.user._id, status: "pending" },
            { $set: { status: "cancelled" }, $unset: { activeSlotKey: "" } },
            { returnDocument: "after", runValidators: true }
        ).populate(populatedAppointment)
        if (!appointment) {
            return res.status(404).json({ message: "Pending appointment not found" })
        }
        await notifyAppointmentStatusChanged(appointment, "patient")
        return res.json({ appointment })
    } catch (error) {
        console.error("Could not cancel appointment:", error)
        return res.status(500).json({ message: "Could not cancel appointment" })
    }
}

async function markAppointmentNotificationRead(req, res) {
    try {
        const appointment = await appointmentModel.findOneAndUpdate(
            {
                _id: req.params.id,
                patient: req.user._id,
                status: { $in: ["approved", "rejected", "cancelled"] },
                patientNotifiedAt: null
            },
            { $set: { patientNotifiedAt: new Date() } },
            { returnDocument: "after" }
        )
        if (!appointment) {
            return res.status(404).json({ message: "Unread appointment notification not found" })
        }
        return res.json({ message: "Notification marked as read" })
    } catch (error) {
        console.error("Could not mark notification as read:", error)
        return res.status(500).json({ message: "Could not update notification" })
    }
}

async function listDoctorAppointments(req, res) {
    try {
        const appointments = await appointmentModel.find({ doctor: req.user._id })
            .populate(populatedAppointment)
            .sort({ appointmentDate: 1, appointmentTime: 1 })
        return res.json({ appointments, total: appointments.length })
    } catch (error) {
        console.error("Could not load doctor appointments:", error)
        return res.status(500).json({ message: "Could not load appointments" })
    }
}

async function updateDoctorAppointment(req, res) {
    try {
        const { status } = req.body ?? {}
        if (!["approved", "rejected"].includes(status)) {
            return res.status(400).json({ message: "Appointment status must be approved or rejected" })
        }
        const pendingAppointment = await appointmentModel.findOne({
            _id: req.params.id,
            doctor: req.user._id,
            status: "pending"
        }).select("appointmentDate appointmentTime")
        if (!pendingAppointment) {
            return res.status(404).json({ message: "Pending appointment not found" })
        }
        const update = { $set: { status, patientNotifiedAt: null } }
        if (status === "approved") {
            update.$set.activeSlotKey = `${req.user._id}:${pendingAppointment.appointmentDate.toISOString().slice(0, 10)}:${pendingAppointment.appointmentTime}`
        } else {
            update.$unset = { activeSlotKey: "" }
        }
        const appointment = await appointmentModel.findOneAndUpdate(
            { _id: req.params.id, doctor: req.user._id, status: "pending" },
            update,
            { returnDocument: "after", runValidators: true }
        ).populate(populatedAppointment)
        if (!appointment) {
            return res.status(404).json({ message: "Pending appointment not found" })
        }
        await notifyAppointmentStatusChanged(appointment, "doctor")
        return res.json({ appointment })
    } catch (error) {
        if (error.name === "CastError") {
            return res.status(404).json({ message: "Pending appointment not found" })
        }
        if (error.code === 11000) {
            return res.status(409).json({ message: "This appointment time is already booked. The request remains pending." })
        }
        console.error("Could not update appointment:", error)
        return res.status(500).json({ message: "Could not update appointment" })
    }
}

async function updateAdminAppointment(req, res) {
    try {
        const { status } = req.body ?? {}
        if (!["approved", "cancelled"].includes(status)) {
            return res.status(400).json({ message: "Admin can confirm or cancel an appointment" })
        }

        const filter = {
            _id: req.params.id,
            status: status === "approved" ? "pending" : { $in: ["pending", "approved"] }
        }
        const update = { $set: { status, patientNotifiedAt: null } }
        if (status === "approved") {
            const current = await appointmentModel.findOne(filter).select("doctor appointmentDate appointmentTime")
            if (!current) {
                return res.status(404).json({ message: "Pending appointment not found. It may already have been updated." })
            }
            update.$set.activeSlotKey = `${current.doctor}:${current.appointmentDate.toISOString().slice(0, 10)}:${current.appointmentTime}`
        } else {
            update.$unset = { activeSlotKey: "" }
        }

        const appointment = await appointmentModel.findOneAndUpdate(
            filter,
            update,
            { returnDocument: "after", runValidators: true }
        ).populate(populatedAppointment)
        if (!appointment) {
            return res.status(404).json({ message: "Appointment not found or is no longer eligible for this action" })
        }
        await notifyAppointmentStatusChanged(appointment, "admin")
        return res.json({ appointment })
    } catch (error) {
        if (error.name === "CastError") {
            return res.status(404).json({ message: "Appointment not found" })
        }
        if (error.code === 11000) {
            return res.status(409).json({ message: "This doctor already has an active appointment at that time." })
        }
        console.error("Could not update appointment as admin:", error)
        return res.status(500).json({ message: "Could not update appointment" })
    }
}

async function getAdminDashboard(req, res) {
    try {
        const [patients, doctors, appointments, users, allAppointments] = await Promise.all([
            userModel.countDocuments({ role: { $in: ["patient", "user"] } }),
            userModel.countDocuments({ role: "doctor" }),
            appointmentModel.countDocuments(),
            userModel.find({ role: { $in: ["patient", "doctor", "admin", "user"] } })
                .sort({ createdAt: -1 }),
            appointmentModel.find().populate(populatedAppointment)
                .sort({ appointmentDate: -1, appointmentTime: -1 })
        ])
        return res.json({
            stats: { patients, doctors, appointments },
            users: users.map(userSummary),
            appointments: allAppointments
        })
    } catch (error) {
        console.error("Could not load admin dashboard:", error)
        return res.status(500).json({ message: "Could not load the admin dashboard" })
    }
}

async function listAdminUsers(req, res) {
    try {
        const users = await userModel.find({ role: { $in: ["patient", "doctor", "admin", "user"] } })
            .sort({ createdAt: -1 })
        return res.json({ users: users.map(userSummary) })
    } catch (error) {
        console.error("Could not load clinic users:", error)
        return res.status(500).json({ message: "Could not load users" })
    }
}

async function listAdminAppointments(req, res) {
    try {
        const appointments = await appointmentModel.find()
            .populate(populatedAppointment)
            .sort({ appointmentDate: -1, appointmentTime: -1 })
        return res.json({ appointments })
    } catch (error) {
        console.error("Could not load clinic appointments:", error)
        return res.status(500).json({ message: "Could not load appointments" })
    }
}

async function getAdminStats(req, res) {
    try {
        const [patients, doctors, appointments] = await Promise.all([
            userModel.countDocuments({ role: { $in: ["patient", "user"] } }),
            userModel.countDocuments({ role: "doctor" }),
            appointmentModel.countDocuments()
        ])
        return res.json({ stats: { patients, doctors, appointments } })
    } catch (error) {
        console.error("Could not load clinic statistics:", error)
        return res.status(500).json({ message: "Could not load clinic statistics" })
    }
}

async function createDoctor(req, res) {
    try {
        const body = req.body ?? {}
        const name = typeof body.name === "string" ? body.name.trim() : ""
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
        const password = body.password
        const specialization = typeof body.specialization === "string" ? body.specialization.trim() : ""
        const profilePicture = typeof body.profilePicture === "string" ? body.profilePicture.trim() : ""
        const experience = Number(body.experience)
        if (!name || name.length > 80 || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
            || typeof password !== "string" || password.length < 8
            || !specialization || specialization.length > 100
            || profilePicture.length > 500 || !validImageUrl(profilePicture)
            || !Number.isInteger(experience) || experience < 0 || experience > 80) {
            return res.status(400).json({ message: "Provide a name, valid email, password of at least 8 characters, specialization, experience from 0 to 80 years, and an optional HTTP(S) profile picture URL" })
        }
        if (await userModel.exists({ email })) {
            return res.status(409).json({ message: "An account with that email already exists" })
        }
        const baseUsername = name.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 30) || email.split("@")[0].slice(0, 30) || "doctor"
        let username = baseUsername
        for (let suffix = 2; await userModel.exists({ username }); suffix += 1) {
            username = `${baseUsername.slice(0, 35)}_${suffix}`
        }
        const doctor = await userModel.create({
            name,
            username,
            email,
            password: await bcrypt.hash(password, 12),
            role: "doctor",
            specialization,
            experience,
            profilePicture,
            isActive: true
        })
        return res.status(201).json({ user: userSummary(doctor) })
    } catch (error) {
        console.error("Could not create doctor:", error)
        return res.status(500).json({ message: "Could not create doctor account" })
    }
}

async function updateUserStatus(req, res) {
    try {
        const { isActive } = req.body ?? {}
        if (typeof isActive !== "boolean") {
            return res.status(400).json({ message: "isActive must be a boolean" })
        }
        const user = await userModel.findOneAndUpdate(
            { _id: req.params.id, role: { $in: ["patient", "doctor", "user"] } },
            { $set: { isActive } },
            { returnDocument: "after", runValidators: true }
        )
        if (!user) {
            return res.status(404).json({ message: "Patient or doctor not found" })
        }
        return res.json({ user: userSummary(user) })
    } catch (error) {
        console.error("Could not update user status:", error)
        return res.status(500).json({ message: "Could not update account status" })
    }
}

async function deleteUser(req, res) {
    try {
        const user = await userModel.findOne({
            _id: req.params.id,
            role: { $in: ["patient", "doctor", "user"] }
        })
        if (!user) {
            return res.status(404).json({ message: "Patient or doctor not found" })
        }
        await appointmentModel.deleteMany({
            $or: [{ patient: user._id }, { doctor: user._id }]
        })
        await userModel.deleteOne({ _id: user._id })
        return res.json({ message: "User and related appointments deleted" })
    } catch (error) {
        console.error("Could not delete user:", error)
        return res.status(500).json({ message: "Could not delete user" })
    }
}

export {
    listDoctors,
    getDoctorById,
    bookAppointment,
    listPatientAppointments,
    cancelPatientAppointment,
    markAppointmentNotificationRead,
    listDoctorAppointments,
    updateDoctorAppointment,
    updateAdminAppointment,
    getAdminDashboard,
    listAdminUsers,
    listAdminAppointments,
    getAdminStats,
    createDoctor,
    updateUserStatus,
    deleteUser
}
