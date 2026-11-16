import express from "express"
import {
    bookAppointment,
    cancelPatientAppointment,
    createDoctor,
    deleteUser,
    getAdminDashboard,
    getAdminStats,
    getDoctorById,
    listAdminAppointments,
    listAdminUsers,
    listDoctorAppointments,
    listDoctors,
    listPatientAppointments,
    markAppointmentNotificationRead,
    updateDoctorAppointment,
    updateAdminAppointment,
    updateUserStatus
} from "../controllers/clinic.controller.js"
import { authenticate, requireRole } from "../middleware/auth.middleware.js"

const router = express.Router()

router.use(authenticate)

router.get("/doctors", listDoctors)
router.get("/doctors/:id", getDoctorById)
router.post("/appointments", requireRole("patient"), bookAppointment)
router.get("/appointments/mine", requireRole("patient"), listPatientAppointments)
router.get("/appointments/my", requireRole("patient"), listPatientAppointments)
router.patch("/appointments/:id/cancel", requireRole("patient"), cancelPatientAppointment)
router.patch("/appointments/:id/notification/read", requireRole("patient"), markAppointmentNotificationRead)
router.get("/appointments/doctor", requireRole("doctor"), listDoctorAppointments)
router.patch("/appointments/:id/status", requireRole("doctor"), updateDoctorAppointment)

router.get("/doctor/appointments", requireRole("doctor"), listDoctorAppointments)
router.patch("/doctor/appointments/:id", requireRole("doctor"), updateDoctorAppointment)

router.get("/admin/dashboard", requireRole("admin"), getAdminDashboard)
router.get("/admin/users", requireRole("admin"), listAdminUsers)
router.get("/admin/appointments", requireRole("admin"), listAdminAppointments)
router.patch("/admin/appointments/:id/status", requireRole("admin"), updateAdminAppointment)
router.get("/admin/stats", requireRole("admin"), getAdminStats)
router.post("/admin/doctors", requireRole("admin"), createDoctor)
router.patch("/admin/users/:id/status", requireRole("admin"), updateUserStatus)
router.delete("/admin/users/:id", requireRole("admin"), deleteUser)

export default router
