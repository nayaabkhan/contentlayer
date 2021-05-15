import type * as Core from '@contentlayer/core'
import { pick } from '@contentlayer/utils'
import { DocumentDef, FieldDef, ListFieldItem, ObjectDef, SchemaDef } from './schema'

export function makeCoreSchema(schemaDef: SchemaDef): Core.SchemaDef {
  const coreDocumentDefMap: Core.DocumentDefMap = {}
  const coreObjectDefMap: Core.ObjectDefMap = {}

  for (const documentDef of schemaDef.documentDefs) {
    let fieldDefs = Object.entries(documentDef.fields).map(fieldDefToCoreFieldDef)

    if (documentDef.fileType === undefined || documentDef.fileType === 'md') {
      fieldDefs.push({
        type: 'markdown',
        name: 'content',
        label: 'Markdown content',
        description: 'Default markdown file content',
        default: undefined,
        const: undefined,
        hidden: undefined,
        required: undefined,
      })
    }

    const computedFields = Object.entries(documentDef.computedFields ?? {}).map<Core.ComputedField>(
      ([name, computedField]) => ({ ...pick(computedField, ['description', 'resolve', 'type']), name }),
    )

    const coreDocumentDef: Core.DocumentDef = {
      _tag: 'DocumentDef',
      ...pick(documentDef, ['name', 'description', 'labelField']),
      label: documentDef.label ?? documentDef.name,
      isSingleton: documentDef.isSingleton ?? false,
      fieldDefs,
      computedFields,
    }
    coreDocumentDefMap[documentDef.name] = coreDocumentDef
  }

  const objectDefs = collectObjectDefs(schemaDef.documentDefs)
  for (const objectDef of objectDefs) {
    const coreObjectDef: Core.ObjectDef = {
      _tag: 'ObjectDef',
      ...pick(objectDef, ['name', 'description', 'labelField']),
      label: objectDef.label ?? objectDef.name,
      fieldDefs: Object.entries(objectDef.fields).map(fieldDefToCoreFieldDef),
    }
    coreObjectDefMap[coreObjectDef.name] = coreObjectDef
  }

  return { documentDefMap: coreDocumentDefMap, objectDefMap: coreObjectDefMap }
}

function fieldDefToCoreFieldDef([name, fieldDef]: [name: string, fieldDef: FieldDef]): Core.FieldDef {
  const baseFields: Core.FieldBase = {
    ...pick(fieldDef, ['type', 'default', 'description', 'required', 'const', 'hidden']),
    label: fieldDef.label ?? name,
    name,
  }
  switch (fieldDef.type) {
    case 'list':
      return <Core.ListFieldDef>{ ...baseFields, of: fieldListItemsToCoreFieldListDefItems(fieldDef.of) }
    case 'polymorphic_list':
      return <Core.PolymorphicListFieldDef>{
        ...baseFields,
        typeField: fieldDef.typeField,
        of: fieldDef.of.map(fieldListItemsToCoreFieldListDefItems),
      }
    case 'object':
      return <Core.ObjectFieldDef>{ ...baseFields, objectName: fieldDef.object().name }
    case 'inline_object':
      const fieldDefs = Object.entries(fieldDef.fields).map(fieldDefToCoreFieldDef)
      return <Core.InlineObjectFieldDef>{ ...baseFields, fieldDefs }
    case 'reference':
      return <Core.ReferenceFieldDef>{ ...baseFields, documentName: fieldDef.document().name }
    case 'enum':
      return <Core.EnumFieldDef>{ ...baseFields, options: fieldDef.options }
    default:
      return {
        // needs to pick again since fieldDef.type has been
        ...pick(fieldDef, ['type', 'default', 'description', 'label', 'required', 'const', 'hidden']),
        name,
      }
  }
}

function fieldListItemsToCoreFieldListDefItems(listFieldItem: ListFieldItem): Core.ListFieldDefItem {
  switch (listFieldItem.type) {
    case 'boolean':
    case 'string':
      return pick(listFieldItem, ['labelField', 'type'])
    case 'object':
      return {
        type: 'object',
        labelField: listFieldItem.labelField,
        objectName: listFieldItem.object().name,
      }
    case 'enum':
      return {
        type: 'enum',
        labelField: listFieldItem.labelField,
        options: listFieldItem.options,
      }
    case 'inline_object':
      return {
        type: 'inline_object',
        labelField: listFieldItem.labelField,
        fieldDefs: Object.entries(listFieldItem.fields).map(fieldDefToCoreFieldDef),
      }
  }
}

function collectObjectDefs(documentDefs: DocumentDef[]): ObjectDef[] {
  const objectDefMap: { [objectDefName: string]: ObjectDef } = {}

  const traverseObjectDef = (objectDef: ObjectDef) => {
    if (objectDef.name in objectDefMap) {
      return
    }

    objectDefMap[objectDef.name] = objectDef

    Object.values(objectDef.fields).forEach(traverseField)
  }

  const traverseField = (field: FieldDef) => {
    switch (field.type) {
      case 'object':
        return traverseObjectDef(field.object())
      case 'inline_object':
        return Object.values(field.fields).forEach(traverseField)
      case 'polymorphic_list':
        return field.of.forEach(traverseListFieldItem)
      case 'list':
        return traverseListFieldItem(field.of)
    }
  }

  const traverseListFieldItem = (listFieldItem: ListFieldItem) => {
    switch (listFieldItem.type) {
      case 'object':
        return traverseObjectDef(listFieldItem.object())
    }
  }

  documentDefs.flatMap((_) => Object.values(_.fields)).forEach(traverseField)

  return Object.values(objectDefMap)
}