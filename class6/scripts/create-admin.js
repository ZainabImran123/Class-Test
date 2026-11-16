import bcrypt from "bcryptjs"
import connectDB from "../src/db/db.js"
import userModel from "../src/models/users.model.js"

const name = process.env.ADMIN_NAME?.trim()
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
const password = process.env.ADMIN_PASSWORD

if (!name || !email || !password || password.length < 8) {
    console.error("Set ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD (at least 8 characters) in class6/.env.")
    process.exitCode = 1
} else {
    try {
        await connectDB()
        const admins = await userModel.find({ role: "admin" }).select("_id email")
        const otherAdmin = admins.find(admin => admin.email.toLowerCase() !== email)
        if (otherAdmin) {
            throw new Error("Another admin account already exists. Resolve the existing admin before provisioning the configured clinic admin.")
        }

        let account = await userModel.findOne({ email }).select("+password")
        if (account) {
            account.name = name
            account.role = "admin"
            account.adminAccountKey = "clinic-admin"
            account.password = await bcrypt.hash(password, 12)
            account.isActive = true
            await account.save()
        } else {
            const baseUsername = name.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 30) || "admin"
            let username = baseUsername
            for (let suffix = 2; await userModel.exists({ username }); suffix += 1) {
                username = `${baseUsername.slice(0, 35)}_${suffix}`
            }
            account = await userModel.create({
                name,
                username,
                email,
                password: await bcrypt.hash(password, 12),
                role: "admin",
                adminAccountKey: "clinic-admin",
                isActive: true
            })
        }
        console.log(`The single clinic administrator is ready for ${email}`)
    } catch (error) {
        console.error("Could not create administrator:", error.message)
        process.exitCode = 1
    } finally {
        const mongoose = await import("mongoose")
        await mongoose.default.disconnect()
    }
}
