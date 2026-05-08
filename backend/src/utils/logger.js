const pino = require("pino");
const config = require("./config");

// Fields to redact from logs everywhere (request bodies, response bodies,
// nested error details, etc.). Pino supports dot-paths and wildcards.
const REDACT_PATHS = [
  // Request fields
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-bootstrap-token']",
  "req.body.password",
  "req.body.adminPassword",
  "req.body.seedToken",
  "req.body.apiKey",
  "req.body.secret",
  "req.body.token",
  "req.body.passwordHash",
  // Response fields
  "res.headers['set-cookie']",
  // Generic field redaction (anywhere in the log object tree)
  "*.password",
  "*.passwordHash",
  "*.adminPassword",
  "*.seedToken",
  "*.token",
  "*.secret",
  "*.JWT_SECRET",
  "*.BOOTSTRAP_SEED_TOKEN",
];

const baseOptions = {
  level: process.env.LOG_LEVEL || (config.isProd ? "info" : "debug"),
  redact: {
    paths: REDACT_PATHS,
    censor: "[REDACTED]",
  },
  base: { service: "bd-smart-pos-backend", env: config.env },
  timestamp: pino.stdTimeFunctions.isoTime,
};

const transport = !config.isProd
  ? {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss.l",
        ignore: "pid,hostname,service,env",
      },
    }
  : undefined;

const logger = transport
  ? pino({ ...baseOptions, transport })
  : pino(baseOptions);

module.exports = logger;
