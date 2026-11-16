import mongoose from "mongoose"
import appointmentModel from "../models/appointments.model.js"
import notificationModel from "../models/notifications.model.js"

async function connectDB() {
  const uri = process.env.MONGODB_URI
  if (!uri) {
    throw new Error("MONGODB_URI is not configured")
  }
  if (/<(?:username|password|cluster|database)>/i.test(uri)) {
    throw new Error("MONGODB_URI still contains example placeholders. Replace them with your MongoDB connection details in class6/.env.")
  }

  await mongoose.connect(uri)
  await Promise.all([appointmentModel.init(), notificationModel.init()])
  console.log("Connected to DB")
}

export default connectDB
