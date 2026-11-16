import mongoose from "mongoose"

const notificationSchema = new mongoose.Schema({
    recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        required: true,
        index: true
    },
    type: {
        type: String,
        enum: ["patient_registered", "appointment_booked", "appointment_status"],
        required: true
    },
    title: {
        type: String,
        required: true,
        maxlength: 120
    },
    message: {
        type: String,
        required: true,
        maxlength: 500
    },
    appointment: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "appointment",
        default: null
    },
    status: {
        type: String,
        enum: ["pending", "approved", "rejected", "cancelled"],
        default: null
    },
    isRead: {
        type: Boolean,
        default: false
    }
}, { timestamps: true })

notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 })

export default mongoose.model("notification", notificationSchema)
