const isSafeNext = (url) => {
    if (typeof url !== 'string') return false;
    if (!url.startsWith('/')) return false;
    if (url.startsWith('//')) return false;
    if (url.includes('://')) return false;
    if (url.startsWith('/auth/')) return false;
    return true;
};

const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        const nextUrl = isSafeNext(req.originalUrl) ? req.originalUrl : undefined;
        const loginUrl = nextUrl
            ? `/auth/login?next=${encodeURIComponent(nextUrl)}`
            : '/auth/login';
        return res.redirect(loginUrl);
    }
    next();
};

const redirectIfAuthenticated = (req, res, next) => {
    if (req.session.user) {
        const nextUrl = isSafeNext(req.query.next) ? req.query.next : '/dashboard';
        return res.redirect(nextUrl);
    }
    next();
};

module.exports = {
    requireAuth,
    redirectIfAuthenticated,
    isSafeNext,
};