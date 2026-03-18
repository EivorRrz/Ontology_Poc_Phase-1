/**
 * @Module LLM JSON schemas..!
 * @Description Define JSON schemas for strucutred LLM output..!
 * Enforces consisent responses format from local llm..!
 * Basically its making the response more accurate with the help of llm..!
 */

/**
 * Schema for primary key analysis....!
 * Created the primary-key and foreign-key schema for the llm to understand the data model..!
 * And one column-Batch schema to send all the columns in one go..!
 */

export const primaryKeySchema = {
    /**
     * As the schema will contain the Properties.>!
     * Properties are isPrimary->confidence->rationale..!
     */
    type: "object",//as we knw the schema will be of object..!
    properties: {
        isPrimaryKey: {
            type: "boolean",//we will define is this primary Yes Or No..!
            description: "Whether this column should be a primary key"
        },
        confidence: {
            type: "number",//means the accuracy of the primary key..!
            minimum: 0,
            maximum: 1,
            description: "Confidence score (0-1) in primary key detection"
        },
        rationale: {
            type: "string",
            description: "Explanation of why this column is/is not a primary key"
        }

    },
    required: ['isPrimaryKey', 'confidence', 'rationale']//the required fields..!
}

/**
 * Schema for foreign Key Analysis..!
 */

export const foreignKeySchema = {
    type: "object",
    properties: {
        isForeignKey: {
            type: "boolean",
            description: "Whether this column is a foreign key"
        },
        confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "Confidence score (0-1) in foreign key detection"
        },
        /**
         * So it will tell which table and column is referenced by the foreign key..!
         * Null if not FK..!
         */
        referenceTable: {
            type: "string",
            description: "The table this FK references (null if not FK)"
        },
        referenceColumn: {
            type: "string",
            description: "The column this FK references (null if not FK)"
        },
        rationale: {
            type: "string",
            description: "Explanation of why this column is/is not a foreign key"
        }
    },
    required: ['isForeignKey', 'confidence', 'rationale']

}

/**
 * Schema for batch column analysis
 */
export const batchColumnSchema = {
    type: "object",
    properties: {
        columns: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    //The-Batch basically for the column..!
                    //the batch will have everything in one go...!
                    columnName: { type: "string" },
                    tableName: { type: "string" },
                    isPrimaryKey: { type: "boolean" },
                    pkConfidence: { type: "number", minimum: 0, maximum: 1 },
                    pkRationale: { type: "string" },
                    isForeignKey: { type: "boolean" },
                    fkConfidence: { type: "number", minimum: 0, maximum: 1 },
                    referenceTable: { type: "string" },
                    referencesColumn: { type: "string" },
                    fkRationals: { type: "string" },
                },
                required: ["columnName", "tableName", "isPrimaryKey", "isForeignKey"]
            }
        },
        overallAnalysis: {
            type: "string",
            description: "Summary of the data model-analysis..!"
        }
    },
    required: ["columns"]
};

/**
 * Get Llama.cpp compatible grammar from schema
 * This helps enforce JSON structure in LLM output
 */
export function getSchemaPrompt(schema){
    //so here null is for the replacment and 2 is for the space..!
    //we will convert the schema to a string and then add it to the prompt..!
    return `You Must Respond with valid-json:${JSON.stringify(schema,null,2)}`
}