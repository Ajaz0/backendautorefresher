require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const userRoutes = require("./routes/user");
const pricingRoutes = require("./routes/pricing");
const paymentsRoutes = require("./routes/payments");
const adminRoutes = require("./routes/admin");

const app = express();
const PORT = process.env.PORT || 5000;

// Security Middlewares
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "http://localhost:*", "https://*"]
    }
  }
}));

app.use(cors());

// Rate Limiter to prevent API abuse
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests from this IP, please try again after 15 minutes." }
});

// Apply rate limiter to API routes only
app.use("/api/", apiLimiter);

// Bind body parser
app.use(express.json());

// Bind static folder for serving Admin Dashboard
app.use(express.static(path.join(__dirname, "public")));

// Route Bindings
app.use("/api/users", userRoutes);
app.use("/api/pricing", pricingRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/admin", adminRoutes);

// Simple Health Check
app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy", timestamp: new Date().toISOString() });
});

// Centralized error handler
app.use((err, req, res, next) => {
  console.error("Express uncaught routing exception:", err);
  res.status(500).json({ error: "Something went wrong inside the server." });
});

// Listen on configured port
app.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`🚀 Auto Refresh SaaS Server is running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`📍 Web admin portal path: http://localhost:${PORT}/admin`);
  console.log(`===================================================`);
});
