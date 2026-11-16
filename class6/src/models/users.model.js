import mongoose from "mongoose"

const userSchema= new mongoose.Schema({
    name: {
        type: String,
        trim: true,
        required: true
    },
    username:{
        type: String,
        unique: true,
        required: true,
        trim: true
    },
    email:  {
        type: String,
        unique: true,
        required:true
    },
    password: {
        type: String,
        required:false,
        select: false
    },
    googleId: {
        type: String,
        unique: true,
        sparse: true
    },
    role:{
        type: String,
        default: "patient",
        enum: ["patient", "doctor", "admin"]
    },
    adminAccountKey: {
        type: String,
        unique: true,
        sparse: true,
        select: false
    },
    specialization: {
        type: String,
        trim: true,
        default: ""
    },
    experience: {
        type: Number,
        min: 0,
        default: 0
    },
    profilePicture: {
        type: String,
        trim: true,
        maxlength: 500,
        default: ""
    },
    isActive: {
        type: Boolean,
        default: true
    }
})
const userModel = mongoose.model("user",userSchema)
export default userModel
