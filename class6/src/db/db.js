import mongoose from "mongoose"
import appointmentModel from "../models/appointments.model.js"
import notificationModel from "../models/notifications.model.js"

let connectionPromise

async function connectDB() {
  const uri = process.env.MONGODB_URI
  if (!uri) {
    throw new Error("MONGODB_URI is not configured")
  }
  if (/<(?:username|password|cluster|database)>/i.test(uri)) {
    throw new Error("MONGODB_URI still contains example placeholders. Replace them with your MongoDB connection details in class6/.env.")
  }

  if (mongoose.connection.readyState === 1) return
  if (!connectionPromise) {
    connectionPromise = (async () => {
      try {
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 })
        await Promise.all([appointmentModel.init(), notificationModel.init()])
        console.log("Connected to DB")
      } finally {
        connectionPromise = undefined
      }
    })()
  }
  await connectionPromise
}

async function ensureDBConnection(req, res, next) {
  try {
    await connectDB()
    return next()
  } catch (error) {
    const message = error instanceof Error
      ? error.message.replace(/mongodb(?:\+srv)?:\/\/[^\s"'`]+/gi, "[redacted MongoDB URI]")
      : "Unknown database connection error"
    console.error("Clinic database connection failed:", error.name || "Error", message)
    return res.status(503).json({
      message: "The clinic database is unavailable. Check MONGODB_URI in the Vercel backend environment and confirm the database allows connections from Vercel, then redeploy."
    })
  }
}

// Keep named exports AND add connectDB as the default export
export { connectDB, ensureDBConnection }
export default connectDB