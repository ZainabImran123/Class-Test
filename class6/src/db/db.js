import mongoose from "mongoose"
import appointmentModel from "../models/appointments.model.js"

async function connectDB() {
  const uri = process.env.MONGODB_URI
  if (!uri) {
    throw new Error("MONGODB_URI is not configured")
  }

  await mongoose.connect(uri)
  await appointmentModel.init()
  console.log("Connected to DB")
}

export default connectDB
