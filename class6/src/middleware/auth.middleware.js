import jwt from "jsonwebtoken"
import userModel from "../models/users.model.js"

function getJwtSecret() {
    const secret = process.env.JWT_SECRET
    if (!secret || secret.length < 32) {
        throw new Error("JWT_SECRET must be configured with at least 32 characters")
    }
    return secret
}

async function authenticate(req, res, next) {
    try {
        const token = req.cookies?.token
        if (!token) {
            return res.status(401).json({ message: "Please sign in to continue" })
        }

        const payload = jwt.verify(token, getJwtSecret())
        const user = await userModel.findById(payload.id)
        if (!user || user.isActive === false) {
            res.clearCookie("token")
            return res.status(401).json({ message: "Your account is unavailable. Please sign in again." })
        }
        const configuredAdminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase()
        if (user.role === "admin" && configuredAdminEmail && user.email.toLowerCase() !== configuredAdminEmail) {
            res.clearCookie("token")
            return res.status(403).json({ message: "This account is not the configured clinic administrator" })
        }

        req.user = user
        return next()
    } catch (error) {
        if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
            return res.status(401).json({ message: "Your session has expired. Please sign in again." })
        }
        console.error("Authentication failed:", error)
        return res.status(500).json({ message: "Could not verify your session" })
    }
}

function requireRole(...roles) {
    return (req, res, next) => {
        const role = req.user.role === "user" ? "patient" : req.user.role
        if (!roles.includes(role)) {
            return res.status(403).json({ message: "You do not have permission to access this resource" })
        }
        return next()
    }
}

export { authenticate, requireRole }
