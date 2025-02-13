// logger.js
const logger = {
    info: (path, message, obj = {}) => {
        console.log(`○ ${new Date().toISOString()} ○ info ○ ${path} ○ ${message}`, obj);
    },
    error: (path, message, error = {}) => {
        console.error(`⨯ ${new Date().toISOString()} ⨯ error ⨯ ${path} ⨯ ${message}`, error);
    },
    warn: (path, message, obj = {}) => {
        console.warn(`⚠ ${new Date().toISOString()} ⚠ warn ⚠ ${path} ⚠ ${message}`, obj);
    },
    // Add a middleware function that can be exported
    requestLogger: (req, res, next) => {
        const start = Date.now();
        const { method, url, headers } = req;
        
        logger.info('request', `${method} ${url}`, {
            userAgent: headers['user-agent'],
            params: req.params,
            query: req.query
        });

        res.on('finish', () => {
            const duration = Date.now() - start;
            logger.info('response', `${method} ${url} ${res.statusCode} - ${duration}ms`);
        });

        next();
    }
};

export default logger;