import mongoose from "mongoose"

const appointmentSchema = new mongoose.Schema({
    patient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        required: true
    },
    doctor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        required: true
    },
    appointmentDate: {
        type: Date,
        required: true
    },
    appointmentTime: {
        type: String,
        required: true,
        match: /^([01]\d|2[0-3]):[0-5]\d$/
    },
    reason: {
        type: String,
        required: true,
        trim: true,
        maxlength: 1000
    },
    status: {
        type: String,
        enum: ["pending", "approved", "rejected", "cancelled"],
        default: "pending"
    },
    activeSlotKey: {
        type: String,
        unique: true,
        sparse: true
    },
    patientNotifiedAt: {
        type: Date,
        default: null
    }
}, { timestamps: true })

appointmentSchema.index({ patient: 1, appointmentDate: -1 })

export default mongoose.model("appointment", appointmentSchema)
