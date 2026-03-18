/**
 * @description Using the pinno to log the message in the console..!
 */
import pino from "pino";
const logger = pino({
    //create the instance..!
    /**
     * create the logger with the level of log and transport of the log..!
     */
    level: process.env.LOG_LEVEL || 'info',//take the level from the env or else default to info.
    transport: process.env.NODE_ENV === "development" ? {//if the transport of the log is development 
        //then print the log in the console.
        target: "pinno-pretty",//means to print the log in the console.
        options: {
            colorize: true,
            translateTime: 'HH:MM:ss.1',//get the time of log..!
            ignore: 'pid,hostname',//ignore the pid and hostname.!
        },
        //if not anything return undefined..!
    } : undefined,
});

export default logger;