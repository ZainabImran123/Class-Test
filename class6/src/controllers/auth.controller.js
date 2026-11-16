import userModel from "../models/users.model.js";
import jwt from "jsonwebtoken"
import bcrypt from "bcryptjs"
import { OAuth2Client } from "google-auth-library"
import { timingSafeEqual } from "node:crypto"

const googleClient = new OAuth2Client()

function getJwtSecret() {
    const secret = process.env.JWT_SECRET
    if (!secret || secret.length < 32) {
        throw new Error("JWT_SECRET must be configured with at least 32 characters")
    }

    return secret
}

function issueToken(user, res, secret) {
    const token = jwt.sign(
        { id: user._id.toString(), role: user.role },
        secret,
        { expiresIn: "7d" }
    )

    res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000
    })
}

function publicUser(user) {
    return {
        id: user._id,
        name: user.name || user.username,
        username: user.username,
        email: user.email,
        role: user.role === "user" ? "patient" : user.role,
        specialization: user.specialization || "",
        experience: user.experience || 0,
        profilePicture: user.profilePicture || "",
        isActive: user.isActive !== false
    }
}

function matchesAdminBootstrapPassword(password) {
    const configuredPassword = process.env.ADMIN_PASSWORD
    if (typeof password !== "string" || !configuredPassword) return false
    const submitted = Buffer.from(password)
    const configured = Buffer.from(configuredPassword)
    return submitted.length === configured.length && timingSafeEqual(submitted, configured)
}

async function registerUser(req, res) {
    try {
        const secret = getJwtSecret()
        const body = req.body ?? {}
        const name = typeof body.name === "string"
            ? body.name.trim()
            : typeof body.username === "string" ? body.username.trim() : ""
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
        const password = body.password

        if (!name || name.length < 2 || name.length > 80 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
            || typeof password !== "string" || password.length < 8) {
            return res.status(400).json({ message: "A name, valid email, and a password of at least 8 characters are required" })
        }
        const configuredAdminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase()
        const isAdminEmail = Boolean(configuredAdminEmail && email === configuredAdminEmail)
        if (isAdminEmail && !matchesAdminBootstrapPassword(password)) {
            return res.status(403).json({
                message: "This email is reserved for the clinic administrator. Set ADMIN_PASSWORD in class6/.env to enable its one-time sign-up, or provision it with npm run create-admin."
            })
        }

        if (isAdminEmail) {
            if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12) {
                return res.status(503).json({
                    message: "Admin sign-up needs a strong ADMIN_PASSWORD (at least 12 characters) in class6/.env."
                })
            }
            if (await userModel.exists({ role: "admin" })) {
                return res.status(409).json({ message: "The clinic administrator is already provisioned. Please sign in instead." })
            }
        }

        if (await userModel.exists({ email })) {
            return res.status(409).json({ message: "An account with that email is already in use. Use the existing account or the private admin provisioning command." })
        }

        const baseUsername = name.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 30) || email.split("@")[0].slice(0, 30) || "patient"
        let username = baseUsername
        for (let suffix = 2; await userModel.exists({ username }); suffix += 1) {
            username = `${baseUsername.slice(0, 35)}_${suffix}`
        }
        const hash = await bcrypt.hash(password, 12)
        const user = await userModel.create({
            name,
            username,
            email,
            password: hash,
            role: isAdminEmail ? "admin" : "patient",
            ...(isAdminEmail ? { adminAccountKey: "clinic-admin" } : {}),
            isActive: true
        })
        issueToken(user, res, secret)

        return res.status(201).json({
            message: "Account created successfully",
            user: publicUser(user)
        })
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ message: "An account with that email or username already exists. Please sign in or choose another email." })
        }
        console.error("Registration failed:", error)
        if (error.name === "MongooseError" || error.name === "MongoServerSelectionError"
            || error.name === "MongoNetworkError" || error.name === "MongoParseError") {
            return res.status(503).json({ message: "The clinic database is unavailable. Configure a valid MONGODB_URI in class6/.env and restart the backend." })
        }
        return res.status(500).json({ message: "Could not create account" })
    }
}

async function loginUser(req, res) {
    try {
        const secret = getJwtSecret()
        const body = req.body ?? {}
        const identifier = typeof body.identifier === "string"
            ? body.identifier.trim()
            : typeof body.email === "string"
                ? body.email.trim()
                : typeof body.username === "string"
                    ? body.username.trim()
                    : ""
        const password = body.password

        if (!identifier || typeof password !== "string") {
            return res.status(400).json({ message: "Email or username and password are required" })
        }

        const user = await userModel.findOne({
            $or: [
                { username: identifier },
                { email: identifier.toLowerCase() }
            ]
        }).select("+password")

        const configuredAdminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase()
        if (configuredAdminEmail && identifier.includes("@")
            && identifier.toLowerCase() === configuredAdminEmail
            && user?.role !== "admin") {
            return res.status(503).json({
                message: "The clinic administrator account is not provisioned yet. Configure ADMIN_PASSWORD and a valid MONGODB_URI in class6/.env, then sign up once with the configured admin email and password, or run npm run create-admin."
            })
        }
        if (!user || !user.password || !await bcrypt.compare(password, user.password)) {
            return res.status(401).json({ message: "Invalid email/username or password" })
        }
        if (user.isActive === false) {
            return res.status(403).json({ message: "This account has been deactivated" })
        }

        issueToken(user, res, secret)
        return res.status(200).json({
            message: "Logged in successfully",
            user: publicUser(user)
        })
    } catch (error) {
        console.error("Login failed:", error)
        return res.status(500).json({ message: "Could not log in" })
    }
}

async function googleLogin(req, res) {
    try {
        const secret = getJwtSecret()
        const clientId = process.env.GOOGLE_CLIENT_ID
        const credential = req.body?.credential
        if (!clientId) {
            return res.status(503).json({ message: "Google sign-in is not configured on the server" })
        }
        if (typeof credential !== "string" || !credential) {
            return res.status(400).json({ message: "Google credential is required" })
        }

        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: clientId
        })
        const payload = ticket.getPayload()
        if (!payload?.sub || !payload.email || !payload.email_verified) {
            return res.status(401).json({ message: "Google account must have a verified email" })
        }
        if (payload.email.toLowerCase() === process.env.ADMIN_EMAIL?.trim().toLowerCase()) {
            return res.status(403).json({ message: "The clinic administrator must sign in with the configured password." })
        }

        let user = await userModel.findOne({ googleId: payload.sub })
        if (user?.isActive === false) {
            return res.status(403).json({ message: "This account has been deactivated" })
        }
        if (!user) {
            user = await userModel.findOne({ email: payload.email.toLowerCase() })
            if (user) {
                if (user.isActive === false) {
                    return res.status(403).json({ message: "This account has been deactivated" })
                }
                if (user.googleId && user.googleId !== payload.sub) {
                    return res.status(409).json({ message: "This account is linked to a different Google account" })
                }
                user.name = user.name || user.username
                if (user.role === "user") user.role = "patient"
                user.googleId = payload.sub
                await user.save()
            } else {
                const baseUsername = payload.email.split("@")[0].replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) || "user"
                let username = baseUsername
                while (await userModel.exists({ username })) {
                    username = `${baseUsername}_${Math.random().toString(36).slice(2, 7)}`
                }
                user = await userModel.create({
                    name: username,
                    username,
                    email: payload.email.toLowerCase(),
                    googleId: payload.sub,
                    role: "patient",
                    isActive: true
                })
            }
        }

        issueToken(user, res, secret)
        return res.status(200).json({
            message: "Google sign-in successful",
            user: publicUser(user)
        })
    } catch (error) {
        console.error("Google sign-in failed:", error)
        return res.status(401).json({ message: "Could not verify Google sign-in" })
    }
}

async function getCurrentUser(req, res) {
    return res.json({ user: publicUser(req.user) })
}

function logoutUser(req, res) {
    res.clearCookie("token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax"
    })
    return res.json({ message: "Logged out successfully" })
}

export { registerUser, loginUser, googleLogin, getCurrentUser, logoutUser, publicUser }