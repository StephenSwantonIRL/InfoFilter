const path = require("path");
const express = require("express");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const methodOverride = require("method-override");
const morgan = require("morgan");
const env = require("./config/env");
const { attachCurrentUser } = require("./middleware/auth");
const webRoutes = require("./routes/web");
const apiRoutes = require("./routes/api");

function createApp() {
  const app = express();
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));

  const sessionConfig = {
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false
  };

  if (process.env.NODE_ENV !== "test") {
    sessionConfig.store = MongoStore.create({ mongoUrl: env.mongoUri });
  }

  app.use(morgan("dev"));
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));
  app.use(express.json({ limit: "2mb" }));
  app.use(methodOverride("_method"));
  app.use(express.static(path.join(process.cwd(), "public")));
  app.use(session(sessionConfig));
  app.use(attachCurrentUser);
  app.use((req, res, next) => {
    res.locals.currentUser = req.currentUser || null;
    res.locals.appName = env.appName;
    next();
  });

  app.use("/", webRoutes);
  app.use("/api", apiRoutes);

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use((error, _req, res, _next) => {
    res.status(500).render("reader/error", {
      title: "Application Error",
      currentUser: null,
      error: error.message
    });
  });

  return app;
}

module.exports = { createApp };
