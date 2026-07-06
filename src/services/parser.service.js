/**
 * Parsea un archivo .sql y extrae entidades, campos, tipos, PKs, FKs y relaciones
 * Compatible con MySQL / PostgreSQL / SQL estándar
 */
export function parseSQL(sqlText) {
    const entities = {};      // { TableName: { fields: [], relations: [] } }
    const foreignKeys = [];   // [{ from, fromField, to, toField }]

    // Eliminar comentarios -- y /* */
    const cleaned = sqlText
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/--[^\n]*/g, '');

    // Extraer cada CREATE TABLE
    const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)[`"']?\s*\(([^;]+)\)/gi;
    let match;

    while ((match = tableRegex.exec(cleaned)) !== null) {
        const tableName = match[1];
        const body = match[2];
        entities[tableName] = { fields: [], relations: [] };

        // Separar líneas por coma (respetando paréntesis anidados)
        const lines = splitByComma(body);

        let inlinePKs = [];

        lines.forEach(line => {
            const l = line.trim();
            if (!l) return;

            // PRIMARY KEY (col1, col2)
            if (/^PRIMARY\s+KEY/i.test(l)) {
                const pkMatch = l.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
                if (pkMatch) {
                    inlinePKs = pkMatch[1].split(',').map(c => c.trim().replace(/[`"']/g, ''));
                }
                return;
            }

            // FOREIGN KEY
            if (/^(?:CONSTRAINT\s+\w+\s+)?FOREIGN\s+KEY/i.test(l)) {
                const fkMatch = l.match(/FOREIGN\s+KEY\s*\([`"']?(\w+)[`"']?\)\s+REFERENCES\s+[`"']?(\w+)[`"']?\s*\([`"']?(\w+)[`"']?\)/i);
                if (fkMatch) {
                    foreignKeys.push({
                        from: tableName,
                        fromField: fkMatch[1],
                        to: fkMatch[2],
                        toField: fkMatch[3]
                    });
                }
                return;
            }

            // INDEX, KEY, UNIQUE KEY — ignorar
            if (/^(UNIQUE\s+)?(?:KEY|INDEX)\s/i.test(l)) return;

            // Columna normal
            const colMatch = l.match(/^[`"']?(\w+)[`"']?\s+(.+)$/i);
            if (!colMatch) return;

            const fieldName = colMatch[1];
            const rest = colMatch[2];

            const field = {
                field: fieldName,
                type: extractType(rest),
                required: /NOT\s+NULL/i.test(rest),
                default: extractDefault(rest),
                primaryKey: /PRIMARY\s+KEY/i.test(rest),
                autoIncrement: /AUTO_INCREMENT|AUTOINCREMENT|SERIAL|BIGSERIAL|IDENTITY\s*\(/i.test(rest),
            };

            // Detectar FK inline (REFERENCES en la misma línea)
            const inlineFK = rest.match(/REFERENCES\s+[`"']?(\w+)[`"']?\s*\([`"']?(\w+)[`"']?\)/i);
            if (inlineFK) {
                foreignKeys.push({
                    from: tableName,
                    fromField: fieldName,
                    to: inlineFK[1],
                    toField: inlineFK[2]
                });
            }

            entities[tableName].fields.push(field);
        });

        // Aplicar PKs detectadas en bloque PRIMARY KEY (...)
        if (inlinePKs.length > 0) {
            entities[tableName].fields.forEach(f => {
                if (inlinePKs.includes(f.field)) f.primaryKey = true;
            });
        }

        // Detectar timestamps
        entities[tableName].createdAt = entities[tableName].fields.find(
            f => /^(createdAt|created_at|CreatedAt)$/i.test(f.field)
        )?.field || null;

        entities[tableName].updatedAt = entities[tableName].fields.find(
            f => /^(updatedAt|updated_at|UpdatedAt)$/i.test(f.field)
        )?.field || null;

        // Filtrar timestamps de los fields normales
        entities[tableName].fields = entities[tableName].fields.filter(
            f => !/^(createdAt|created_at|CreatedAt|updatedAt|updated_at|UpdatedAt)$/i.test(f.field)
        );

    }

    // Aplicar relaciones
    foreignKeys.forEach(({ from, fromField, to, toField }) => {
        if (entities[from]) {
            entities[from].relations.push({ type: 'belongsTo', target: to, foreignKey: fromField });
        }
        if (entities[to]) {
            entities[to].relations.push({ type: 'hasMany', target: from, foreignKey: fromField });
        }
    });

    return entities;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function splitByComma(str) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const ch of str) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ',' && depth === 0) {
            parts.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
}

function extractType(rest) {
    const typeMatch = rest.match(/^([\w]+(?:\([^)]+\))?)/i);
    if (!typeMatch) return 'STRING';
    const raw = typeMatch[1].toUpperCase();

    if (/^INT(EGER)?(\(\d+\))?$/.test(raw)) return 'INTEGER';
    if (/^BIGINT(\(\d+\))?$/.test(raw)) return 'BIGINT';
    if (/^TINYINT\(1\)$/.test(raw)) return 'BOOLEAN';
    if (/^TINYINT(\(\d+\))?$/.test(raw)) return 'INTEGER';
    if (/^SMALLINT(\(\d+\))?$/.test(raw)) return 'INTEGER';
    if (/^FLOAT(\(\d+\))?$/.test(raw)) return 'FLOAT';
    if (/^DOUBLE(\(\d+\))?$/.test(raw)) return 'DOUBLE';
    if (/^DECIMAL\(\d+,\s*\d+\)$/.test(raw)) return raw;
    if (/^NUMERIC\(\d+,\s*\d+\)$/.test(raw)) return raw.replace('NUMERIC', 'DECIMAL');
    if (/^VARCHAR\(\d+\)$/.test(raw)) return raw.replace('VARCHAR', 'STRING');
    if (/^CHAR\(\d+\)$/.test(raw)) return raw.replace('CHAR', 'STRING');
    if (/^VARCHAR$/.test(raw)) return 'STRING';
    if (/^TEXT$/.test(raw)) return 'TEXT';
    if (/^LONGTEXT$/.test(raw)) return 'TEXT';
    if (/^BOOLEAN$/.test(raw)) return 'BOOLEAN';
    if (/^BOOL$/.test(raw)) return 'BOOLEAN';
    if (/^DATETIME$/.test(raw)) return 'DATE';
    if (/^TIMESTAMP$/.test(raw)) return 'DATE';
    if (/^DATE$/.test(raw)) return 'DATEONLY';
    if (/^TIME$/.test(raw)) return 'TIME';
    if (/^SERIAL$/.test(raw)) return 'INTEGER';

    // PostgreSQL
    if (/^BIGSERIAL$/.test(raw)) return 'BIGINT';
    if (/^TEXT$/.test(raw)) return 'TEXT';
    if (/^JSONB?$/.test(raw)) return 'JSON';
    if (/^UUID$/.test(raw)) return 'UUID';

    // SQL Server
    if (/^NVARCHAR\(\d+\)$/.test(raw)) return raw.replace('NVARCHAR', 'STRING');
    if (/^NVARCHAR$/.test(raw)) return 'STRING';
    if (/^NTEXT$/.test(raw)) return 'TEXT';
    if (/^BIT$/.test(raw)) return 'BOOLEAN';
    if (/^MONEY$/.test(raw)) return 'DECIMAL(19,4)';
    if (/^UNIQUEIDENTIFIER$/.test(raw)) return 'UUID';
    if (/^DATETIME2$/.test(raw)) return 'DATE';
    if (/^SMALLDATETIME$/.test(raw)) return 'DATE';

    if (/^ENUM\(/.test(raw)) {
        const inner = raw.replace(/^ENUM\(/, '').replace(/\)$/, '');
        const vals = inner.split(',').map(v => `'${v.trim().replace(/['"]/g, '')}'`).join(', ');
        return `ENUM(${vals})`;
    }

    return 'STRING';
}

function extractDefault(rest) {
    const match = rest.match(/DEFAULT\s+([^\s,]+)/i);
    if (!match) return '';

    const val = match[1].replace(/[`'"]/g, '').trim();

    if (/CURRENT_TIMESTAMP/i.test(val)) return '';
    if (/NOW\(\)/i.test(val)) return '';
    if (/GETDATE\(\)/i.test(val)) return '';  // SQL Server
    if (/NEWID\(\)/i.test(val)) return '';  // SQL Server UUID
    if (val.toUpperCase() === 'NULL') return '';

    if (val.toUpperCase() === 'TRUE') return '1';
    if (val.toUpperCase() === 'FALSE') return '0';

    return val;
}