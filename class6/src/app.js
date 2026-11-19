import express  from "express";
import authRoutes from "./routes/auth.routes.js";
import clinicRoutes from "./routes/clinic.routes.js";
import cookieParser from "cookie-parser";
import cors from "cors";
import { ensureDBConnection } from "./db/db.js";
const app = express();
const allowedOrigins = [
    "http://localhost:5173",
    "https://class-test-pwol.vercel.app",
    ...(process.env.FRONTEND_URL || "").split(",")
]
    .map(origin => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean)
    .filter((origin, index, origins) => origins.indexOf(origin) === index)

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true)
        }
        return callback(new Error("This frontend origin is not allowed by the clinic API"))
    },
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());

app.use("/api", ensureDBConnection)
app.use("/api/auth", authRoutes)
app.use("/api", clinicRoutes)
app.use("/api/clinic", clinicRoutes)

export default app;