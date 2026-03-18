//logginInstance..!
import pino from "pino";
import config from "../config.js";


const logger = pino({
    level:config.logLevel,//the level will be dev level..!
    transport:{
        target:"pino-pretty",//the print type.>!
        options:{
            colorize:true,
            translateTime:'SYS:standard',
            ignore:"pid,hostname",
        }
    }
})

export default logger;

