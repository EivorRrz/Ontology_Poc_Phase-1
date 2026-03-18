{
    "success": true,
    "message": "File-Uploaded-SuccessFully..!",
    "data": {
        "fileID": "1767948473668_&_test-metadata.csv",
        "originalName": "test-metadata.csv",
        "size": 576,
        "uploadedAt": "2026-01-09T08:47:53.672Z",
        "metadata": {
            "rowCount": 14,
            "tableCount": 4,
            "tables": [
                "customer",
                "order",
                "product",
                "order_item"
            ]
        },
        "preview": [
            {
                "tableName": "customer",
                "columnName": "id",
                "dataType": "INTEGER",
                "isPrimary": true,
                "isForeignKey": false,
                "_sourceRow": 2
            },
            {
                "tableName": "customer",
                "columnName": "name",
                "dataType": "VARCHAR",
                "isPrimary": false,
                "isForeignKey": false,
                "_sourceRow": 3
            },
            {
                "tableName": "customer",
                "columnName": "email",
                "dataType": "VARCHAR",
                "isPrimary": false,
                "isForeignKey": false,
                "_sourceRow": 4
            },
            {
                "tableName": "order",
                "columnName": "id",
                "dataType": "INTEGER",
                "isPrimary": true,
                "isForeignKey": false,
                "_sourceRow": 5
            },
            {
                "tableName": "order",
                "columnName": "customer_id",
                "dataType": "INTEGER",
                "isPrimary": false,
                "isForeignKey": true,
                "_sourceRow": 6
            }
        ]
    }
}