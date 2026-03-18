User Request:
POST /generate/all
{ "fileId": "1768301805095" }
    ↓
Server:
1. Read artifacts/1768301805095/metadata.json
2. Generate DBML → schema.dbml
3. Generate SQL → postgres.sql, snowflake.sql  
4. Generate ERD → erd.png, erd.svg
5. Update metadata.json (mark artifacts as generated)
    ↓
Response:
{
  "success": true,
  "artifacts": {
    "dbml": "artifacts/1768301805095/schema.dbml",
    "sql_postgres": "artifacts/1768301805095/postgres.sql",
    "sql_snowflake": "artifacts/1768301805095/snowflake.sql",
    "erd_png": "artifacts/1768301805095/erd.png",
    "erd_svg": "artifacts/1768301805095/erd.svg"
  }
}