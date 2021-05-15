import { promises as fs } from 'fs'
import * as path from 'path'
import { combineLatest, defer, Observable } from 'rxjs'
import { switchMap } from 'rxjs/operators'
import { PackageJson } from 'type-fest'
import { Cache } from '..'
import { SourcePlugin } from '../plugin'
import { SchemaDef } from '../schema'
import { makeArtifactsDir } from '../utils'
import { renderDocumentOrObjectDef } from './generate-types'

export const generateDotpkg = ({
  source,
  watchData,
}: {
  source: SourcePlugin
  watchData: boolean
}): Observable<void> => {
  return combineLatest({
    cache: source.fetchData({ watch: watchData, force: true, previousCache: undefined }),
    schemaDef: defer(async () => source.provideSchema()),
    targetPath: defer(async () => makeArtifactsDir()),
  }).pipe(switchMap(generateForCache))
}

const generateForCache = async ({
  cache,
  schemaDef,
  targetPath,
}: {
  schemaDef: SchemaDef
  cache: Cache
  targetPath: string
}): Promise<void> => {
  const withPrefix = (fileOrDirName: string) => path.join(targetPath, fileOrDirName)

  const dataFiles = Object.values(schemaDef.documentDefMap).map((docDef) => ({
    name: docDef.name,
    content: makeDocumentDataFile({
      typeName: docDef.name,
      data: cache.documents.filter((_) => _._typeName === docDef.name),
    }),
  }))

  await Promise.all([
    generateFile({ filePath: withPrefix('package.json'), content: makePackageJson() }),
    generateFile({ filePath: withPrefix('index.js'), content: makeIndexJs({ schemaDef }) }),
    generateFile({ filePath: withPrefix('index.d.ts'), content: makeTypes({ schemaDef }) }),
    ...dataFiles.map(({ name, content }) => generateFile({ filePath: withPrefix(`all${name}.js`), content })),
  ])
}

const makePackageJson = (): string => {
  const packageJson: PackageJson = {
    name: 'dot-contentlayer',
    version: '0.0.0',
    module: './index.js',
    types: './index.d.ts',
  }

  return JSON.stringify(packageJson)
}

const generateFile = async ({ filePath, content }: { filePath: string; content: string }): Promise<void> => {
  await fs.writeFile(filePath, content, 'utf8')
}

const makeDocumentDataFile = ({ typeName, data }: { typeName: string; data: any[] }): string => {
  return `\
export const all${typeName} = ${JSON.stringify(data, null, 2)}
`
}

const makeIndexJs = ({ schemaDef }: { schemaDef: SchemaDef }): string => {
  const typeNames = Object.keys(schemaDef.documentDefMap)
  const constReexports = typeNames.map((typeName) => `export * from './all${typeName}.js'`).join('\n')

  const constImports = typeNames.map((typeName) => `import { all${typeName} } from './all${typeName}.js'`).join('\n')

  return `\
export { isType } from 'contentlayer/client'

${constReexports}
${constImports}

export const allDocuments = [${typeNames.map((typeName) => `...all${typeName}`).join(', ')}]
`
}

const makeTypes = ({ schemaDef }: { schemaDef: SchemaDef }): string => {
  const documentTypes = Object.values(schemaDef.documentDefMap)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((docDef) => ({
      typeName: docDef.name,
      typeDef: renderDocumentOrObjectDef(docDef),
    }))

  const objectTypes = Object.values(schemaDef.objectDefMap)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((objDef) => ({
      typeName: objDef.name,
      typeDef: renderDocumentOrObjectDef(objDef),
    }))

  const dataConsts = Object.keys(schemaDef.documentDefMap)
    .map((typeName) => `export declare const all${typeName}: ${typeName}[]`)
    .join('\n')

  const typeMap = documentTypes
    .map((_) => _.typeName)
    .map((_) => `  ${_}: ${_}`)
    .join('\n')

  return `\
// NOTE This file is auto-generated by the Contentlayer CLI
import type { Markdown } from 'contentlayer/core'
export { isType } from 'contentlayer/client'

export type Image = string
export type { Markdown }

export interface ContentlayerGenTypes {
  documentTypes: DocumentTypes
  documentTypeMap: DocumentTypeMap
  documentTypeNames: DocumentTypeNames
  allTypeNames: AllTypeNames
}

declare global {
  interface ContentlayerGen extends ContentlayerGenTypes {}
}

export type DocumentTypeMap = {
${typeMap}
}

export type AllTypes = DocumentTypes | ObjectTypes
export type AllTypeNames = DocumentTypeNames | ObjectTypeNames

export type DocumentTypes = ${documentTypes.map((_) => _.typeName).join(' | ')}
export type DocumentTypeNames = DocumentTypes['_typeName']

export type ObjectTypes = ${objectTypes.length > 0 ? objectTypes.map((_) => _.typeName).join(' | ') : 'never'}
export type ObjectTypeNames = ObjectTypes['_typeName']

${dataConsts}

export declare const allDocuments: DocumentTypes[]


/** Document types */
${documentTypes.map((_) => _.typeDef).join('\n\n')}  

/** Object types */
${objectTypes.map((_) => _.typeDef).join('\n\n')}  
  
 `
}