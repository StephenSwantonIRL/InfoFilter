async function attachCurrentUser(req, _res, next) {
  if (req.session.user) {
    req.currentUser = req.session.user;
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.currentUser) {
    return res.redirect("/login");
  }

  return next();
}

function requireAdmin(req, res, next) {
  if (!req.currentUser || req.currentUser.role !== "admin") {
    return res.status(403).render("reader/error", {
      title: "Forbidden",
      error: "Admin access is required.",
      currentUser: req.currentUser || null
    });
  }

  return next();
}

module.exports = {
  attachCurrentUser,
  requireAuth,
  requireAdmin
};
