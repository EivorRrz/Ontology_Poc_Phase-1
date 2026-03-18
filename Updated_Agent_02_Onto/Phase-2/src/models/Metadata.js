export class Column {
    constructor({
        name,
        dataType,
        isPrimaryKey = false,
        isForeignKey = false,
        isNullable = true,
        isUnique = false,
        defaultValue = null,
        referencesTable = null,
        referencesColumn = null,
        description = null
    }) {
        this.name = name;
        this.dataType = dataType;
        this.isPrimaryKey = isPrimaryKey;
        this.isForeignKey = isForeignKey;
        this.isNullable = isNullable;
        this.isUnique = isUnique;
        this.defaultValue = defaultValue;
        this.referencesTable = referencesTable;
        this.referencesColumn = referencesColumn;
        this.description = description;
    }
}

export class Table {
    constructor(name, description = null) {
        this.name = name;
        this.columns = [];
        this.description = description;
    }

    get primaryKeys() {
        //to get the primary key we have to iterate over all the keys in the columns..!
        return this.columns.filter(col => col.isPrimaryKey === true);
    }

    get foreignKeys() {
        return this.columns.filter(col => col.isForeignKey);
    }

    addColumn(column) {
        this.columns.push(column);
    }
}

export class Metadata {
    constructor(fileId) {
        this.fileId = fileId;
        this.tables = new Map();//new storage part..1
    }

    addTable(table) {
        this.tables.set(table.name, table);
    }

    getTable(tableName) {
        return this.tables.get(tableName);
    }

    getTotalColumns() {
        let total = 0;
        //get each table from the obejct and from each table we have to fetcht columns.length..!
        for (const table of this.tables.values()) {
            total += table.columns.length;
        }

        return total;
    }
    
    get totalColumns() {
        return this.getTotalColumns();
    }
    
    get tableCount() {
        return this.tables.size;
    }

}
/**
 * Schema for the metadata,table,column..!
 */