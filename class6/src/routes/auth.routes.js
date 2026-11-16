import express from "express";
import { registerUser, loginUser, googleLogin, getCurrentUser, logoutUser } from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
const router = express.Router();
// /api/auth/register
router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/google", googleLogin);
router.get("/me", authenticate, getCurrentUser);
router.post("/logout", logoutUser);

export default router;