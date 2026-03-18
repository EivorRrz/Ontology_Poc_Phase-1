/**
 * @Module Heuristics Index
 * @Description Export all heuristics functions
 */

import { inferPkFK, getInferenceStats } from "./pkFkInference.js";

// Export with both naming conventions for compatibility
//make the alias here..!
export { inferPkFK, inferPkFK as inferPKFK, getInferenceStats };
