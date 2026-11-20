import satisfies from 'semver/functions/satisfies.js'
import validRange from 'semver/ranges/valid.js'
import { compileGlob } from './glob'

/**
 * Mirror of the `exoManifest` branch of `schema/exo.schema.json` plus the
 * semantic rules in `docs/contracts/plugin-manifest.md`. The schema remains the
 * shared shape; a parity test pins the constants used here.
 */

export const MANIFEST_SCHEMA_VERSION = 1
export const MANIFEST_MAX_BYTES = 256 * 1024
export const MANIFEST_TIMEOUT_MS = 5000
export const MANIFEST_MAX_EDITORS = 20
export const MANIFEST_MAX_PANELS = 8
export const MANIFEST_MAX_CONTENT_VIEWS = 16
export const MANIFEST_MAX_VIEW_TITLE = 80
export const MANIFEST_MAX_ICON = 40
export const MANIFEST_MAX_GLOB_LENGTH = 200
export const MANIFEST_MAX_NAME = 80
export const MANIFEST_MAX_DESCRIPTION = 500
export const MANIFEST_MAX_LABEL = 40
export const MANIFEST_MAX_PAGE = 512
export const MANIFEST_PRIORITY_MIN = -100
export const MANIFEST_PRIORITY_MAX = 100
export const MANIFEST_MAX_SETTINGS = 50
export const MANIFEST_MAX_ENUM_VALUES = 50
export const MANIFEST_MAX_SETTING_KEY = 64
export const MANIFEST_MAX_SETTING_DESCRIPTION = 500
export const MANIFEST_MAX_SETTING_STRING = 4096

export const MANIFEST_ID_PATTERN = '^[a-z0-9][a-z0-9.-]{2,63}$'
export const MANIFEST_CONTRIBUTION_ID_PATTERN = '^[a-z0-9][a-z0-9.-]{0,63}$'
export const MANIFEST_SETTING_KEY_PATTERN = '^[a-z][a-zA-Z0-9]*(?:[.-][a-zA-Z0-9]+)*$'
export const MANIFEST_SEMVER_PATTERN =
  '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$'
export const MANIFEST_RELATIVE_PAGE_PATTERN =
  '^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*(?:^|/)\\.\\.(?:/|$))(?!.*[?#\\u0000]).+\\.[Hh][Tt][Mm][Ll]?$'
export const MANIFEST_RELATIVE_ASSET_PATTERN =
  '^(?!/)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*[?#\\u0000]).+$'
export const MANIFEST_HTTPS_URL_PATTERN = '^https://[^\\s@#]+$'

export const PLUGIN_PERMISSIONS = [
  'workspace:read',
  'workspace:write',
  'workspace:list',
  'events:subscribe',
] as const
export const MANIFEST_SETTING_TYPES = ['boolean', 'string', 'number'] as const
export const MANIFEST_RENDERINGS = ['hidden', 'frame'] as const
export const MANIFEST_PANEL_LOCATIONS = ['primary', 'secondary'] as const

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number]
export type ManifestSettingType = (typeof MANIFEST_SETTING_TYPES)[number]
export type ManifestRendering = (typeof MANIFEST_RENDERINGS)[number]
export type ManifestPanelLocation = (typeof MANIFEST_PANEL_LOCATIONS)[number]
export type SettingValue = boolean | string | number

/** `workspace:write` implies read, so either permission grants reads. */
export function hasWorkspaceRead(permissions: PluginPermission[]): boolean {
  return permissions.includes('workspace:read') || permissions.includes('workspace:write')
}

export function hasWorkspaceWrite(permissions: PluginPermission[]): boolean {
  return permissions.includes('workspace:write')
}

/** Listing is a separate permission; the manifest validator requires read too. */
export function hasWorkspaceList(permissions: PluginPermission[]): boolean {
  return permissions.includes('workspace:list')
}

export function hasEventsSubscribe(permissions: PluginPermission[]): boolean {
  return permissions.includes('events:subscribe')
}

export const MANIFEST_REQUIRED_FIELDS = [
  'schemaVersion',
  'id',
  'name',
  'version',
  'publisher',
  'engines',
  'runtime',
  'permissions',
] as const

export type ManifestErrorCode =
  | 'network'
  | 'cors'
  | 'timeout'
  | 'http-status'
  | 'too-large'
  | 'invalid-json'
  | 'invalid-manifest'
  | 'unsupported-origin'
  | 'unsupported-version'
  | 'incompatible-engine'

export interface ManifestIssue {
  code: ManifestErrorCode
  field?: string
  message?: string
  status?: number
}

export interface ManifestPublisher {
  name: string
  url?: string
}

export interface ManifestFileEditor {
  glob: string
  /** Declared relative page, as written in the manifest. */
  entry: string
  /** Resolved absolute page URL. */
  entryUrl: string
  label: string
  priority: number
  /** Whether the handler frame is displayed in the document area. Absent = hidden. */
  rendering?: ManifestRendering
}

export interface ManifestPanel {
  id: string
  title: string
  icon?: string
  location: ManifestPanelLocation
  /** Declared relative page, as written in the manifest. */
  entry: string
  /** Resolved absolute page URL. */
  entryUrl: string
}

export interface ManifestContentView {
  id: string
  title: string
  /** Declared relative page, as written in the manifest. */
  entry: string
  /** Resolved absolute page URL. */
  entryUrl: string
}

export interface ManifestSetting {
  type: ManifestSettingType
  default: SettingValue
  enum?: SettingValue[]
  description?: string
  scope: 'workspace'
}

export interface ManifestConfiguration {
  properties: Record<string, ManifestSetting>
}

export interface PluginManifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION
  manifestUrl: string
  manifestOrigin: string
  controllerUrl: string
  /** Path of the approved directory tree, with a trailing slash. */
  pluginRoot: string
  id: string
  name: string
  version: string
  description?: string
  publisher: ManifestPublisher
  homepage?: string
  license?: string
  icon?: string
  engines: { exo: string }
  permissions: PluginPermission[]
  fileEditors: ManifestFileEditor[]
  panels: ManifestPanel[]
  contentViews: ManifestContentView[]
  configuration?: ManifestConfiguration
}

export type ManifestValidationResult =
  { ok: true; manifest: PluginManifest } | { ok: false; error: ManifestIssue }

export type ManifestLoadResult = ManifestValidationResult

export type EntryFailureReason = 'invalid-contribution' | 'permission-denied'

export type ResolvedEntry =
  { ok: true; url: string; path: string } | { ok: false; reason: EntryFailureReason }

const ID = new RegExp(MANIFEST_ID_PATTERN)
const CONTRIBUTION_ID = new RegExp(MANIFEST_CONTRIBUTION_ID_PATTERN)
const CODICON = /^[a-z0-9-]+$/
const SEMVER = new RegExp(MANIFEST_SEMVER_PATTERN)
const RELATIVE_PAGE = new RegExp(MANIFEST_RELATIVE_PAGE_PATTERN)
const RELATIVE_ASSET = new RegExp(MANIFEST_RELATIVE_ASSET_PATTERN)
const HTTPS_URL = new RegExp(MANIFEST_HTTPS_URL_PATTERN)
const SETTING_KEY = new RegExp(MANIFEST_SETTING_KEY_PATTERN)
const ENCODED_DOT = /%2e/i

function issue(
  code: ManifestErrorCode,
  options: { field?: string; message?: string; status?: number } = {},
): ManifestIssue {
  return { code, ...options }
}

function invalid(field?: string, message?: string): ManifestValidationResult {
  return { ok: false, error: issue('invalid-manifest', { field, message }) }
}

function pointer(...segments: Array<string | number>): string {
  return `/${segments
    .map((segment) => String(segment).replace(/~/g, '~0').replace(/\//g, '~1'))
    .join('/')}`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function unknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  base: string,
): ManifestIssue | null {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      return issue('invalid-manifest', { field: `${base}/${key}` })
    }
  }
  return null
}

function isStringInRange(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max
}

function isHttpsUrl(value: unknown): value is string {
  return typeof value === 'string' && HTTPS_URL.test(value) && !value.includes('\\')
}

function isRelativeAsset(value: unknown): value is string {
  return typeof value === 'string' && RELATIVE_ASSET.test(value)
}

/** A final manifest/entry URL must be HTTPS, or HTTP only on localhost. */
export function isSupportedOriginUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.username !== '' || url.password !== '') return false
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && url.hostname === 'localhost'
}

function isSupportedPageUrl(value: string): boolean {
  if (!isSupportedOriginUrl(value)) return false
  const url = new URL(value)
  return url.search === '' && url.hash === ''
}

function pluginRootFor(controllerUrl: string): string {
  const { pathname } = new URL(controllerUrl)
  return pathname.slice(0, pathname.lastIndexOf('/') + 1)
}

/**
 * Resolve a declared page against the final manifest URL and confine it to the
 * approved plugin root. Used by manifest validation and by registration.
 */
export function resolvePluginEntry(
  declared: unknown,
  manifestUrl: string,
  pluginOrigin: string,
  pluginRoot: string,
): ResolvedEntry {
  if (
    typeof declared !== 'string' ||
    declared.length === 0 ||
    declared.length > MANIFEST_MAX_PAGE
  ) {
    return { ok: false, reason: 'invalid-contribution' }
  }
  if (!RELATIVE_PAGE.test(declared) || declared.includes('\\') || ENCODED_DOT.test(declared)) {
    try {
      const absolute = new URL(declared)
      if (absolute.origin !== pluginOrigin) {
        return { ok: false, reason: 'permission-denied' }
      }
    } catch {
      // Not an absolute URL; fall through to the malformed-page error.
    }
    return { ok: false, reason: 'invalid-contribution' }
  }

  let url: URL
  try {
    url = new URL(declared, manifestUrl)
  } catch {
    return { ok: false, reason: 'invalid-contribution' }
  }
  if (url.origin !== pluginOrigin) return { ok: false, reason: 'permission-denied' }
  if (!isSupportedPageUrl(url.href) || ENCODED_DOT.test(url.pathname)) {
    return { ok: false, reason: 'permission-denied' }
  }
  if (!url.pathname.startsWith(pluginRoot)) {
    return { ok: false, reason: 'permission-denied' }
  }
  return { ok: true, url: url.href, path: url.pathname }
}

function resolveController(
  declared: string,
  manifestUrl: string,
  manifestOrigin: string,
): { ok: true; controllerUrl: string; pluginRoot: string } | { ok: false; error: ManifestIssue } {
  if (
    typeof declared !== 'string' ||
    declared.length === 0 ||
    declared.length > MANIFEST_MAX_PAGE
  ) {
    return { ok: false, error: issue('invalid-manifest', { field: '/runtime/entry' }) }
  }
  if (!RELATIVE_PAGE.test(declared) || ENCODED_DOT.test(declared)) {
    try {
      const absolute = new URL(declared)
      if (absolute.origin !== manifestOrigin) {
        return { ok: false, error: issue('unsupported-origin', { field: '/runtime/entry' }) }
      }
    } catch {
      // Not an absolute URL; fall through to the malformed-relative-page error.
    }
    return { ok: false, error: issue('invalid-manifest', { field: '/runtime/entry' }) }
  }
  let url: URL
  try {
    url = new URL(declared, manifestUrl)
  } catch {
    return { ok: false, error: issue('invalid-manifest', { field: '/runtime/entry' }) }
  }
  if (url.origin !== manifestOrigin) {
    return { ok: false, error: issue('unsupported-origin', { field: '/runtime/entry' }) }
  }
  if (!isSupportedPageUrl(url.href) || ENCODED_DOT.test(url.pathname)) {
    return { ok: false, error: issue('unsupported-origin', { field: '/runtime/entry' }) }
  }
  return { ok: true, controllerUrl: url.href, pluginRoot: pluginRootFor(url.href) }
}

function parsePermissions(value: unknown): PluginPermission[] | ManifestIssue {
  if (!Array.isArray(value) || value.length > PLUGIN_PERMISSIONS.length) {
    return issue('invalid-manifest', { field: '/permissions' })
  }
  const seen = new Set<string>()
  const permissions: PluginPermission[] = []
  for (let index = 0; index < value.length; index += 1) {
    const permission = value[index]
    if (
      typeof permission !== 'string' ||
      !(PLUGIN_PERMISSIONS as readonly string[]).includes(permission) ||
      seen.has(permission)
    ) {
      return issue('invalid-manifest', { field: pointer('permissions', index) })
    }
    seen.add(permission)
    permissions.push(permission as PluginPermission)
  }
  if (seen.has('workspace:write') && !seen.has('workspace:read')) {
    return issue('invalid-manifest', {
      field: '/permissions',
      message: 'workspace:write requires workspace:read.',
    })
  }
  if (seen.has('workspace:list') && !seen.has('workspace:read')) {
    return issue('invalid-manifest', {
      field: '/permissions',
      message: 'workspace:list requires workspace:read.',
    })
  }
  return permissions
}

function parseFileEditors(
  value: unknown,
  manifestUrl: string,
  manifestOrigin: string,
  pluginRoot: string,
): ManifestFileEditor[] | ManifestIssue {
  if (!Array.isArray(value) || value.length > MANIFEST_MAX_EDITORS) {
    return issue('invalid-manifest', { field: '/contributes/fileEditors' })
  }
  const editors: ManifestFileEditor[] = []
  const globs = new Set<string>()
  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index]
    const base = pointer('contributes', 'fileEditors', index)
    if (!isPlainObject(raw)) {
      return issue('invalid-manifest', { field: base })
    }
    const unknown = unknownKeys(raw, ['glob', 'entry', 'label', 'priority', 'rendering'], base)
    if (unknown) return unknown
    if (!hasOwn(raw, 'glob') || typeof raw.glob !== 'string') {
      return issue('invalid-manifest', { field: `${base}/glob` })
    }
    const compiled = compileGlob(raw.glob)
    if (!compiled.ok) {
      return issue('invalid-manifest', { field: `${base}/glob` })
    }
    if (globs.has(raw.glob)) {
      return issue('invalid-manifest', {
        field: `${base}/glob`,
        message: 'A glob may be declared only once.',
      })
    }
    globs.add(raw.glob)
    if (!hasOwn(raw, 'entry')) {
      return issue('invalid-manifest', { field: `${base}/entry` })
    }
    const entry = resolvePluginEntry(raw.entry, manifestUrl, manifestOrigin, pluginRoot)
    if (!entry.ok) {
      return issue(
        entry.reason === 'permission-denied' ? 'unsupported-origin' : 'invalid-manifest',
        { field: `${base}/entry` },
      )
    }
    if (!isStringInRange(raw.label, 1, MANIFEST_MAX_LABEL)) {
      return issue('invalid-manifest', { field: `${base}/label` })
    }
    let priority = 0
    if (hasOwn(raw, 'priority')) {
      if (
        typeof raw.priority !== 'number' ||
        !Number.isInteger(raw.priority) ||
        raw.priority < MANIFEST_PRIORITY_MIN ||
        raw.priority > MANIFEST_PRIORITY_MAX
      ) {
        return issue('invalid-manifest', { field: `${base}/priority` })
      }
      priority = raw.priority
    }
    let rendering: ManifestRendering = 'hidden'
    if (hasOwn(raw, 'rendering')) {
      if (
        typeof raw.rendering !== 'string' ||
        !(MANIFEST_RENDERINGS as readonly string[]).includes(raw.rendering)
      ) {
        return issue('invalid-manifest', { field: `${base}/rendering` })
      }
      rendering = raw.rendering as ManifestRendering
    }
    editors.push({
      glob: raw.glob,
      entry: raw.entry as string,
      entryUrl: entry.url,
      label: raw.label,
      priority,
      rendering,
    })
  }
  return editors
}

function parsePanels(
  value: unknown,
  manifestUrl: string,
  manifestOrigin: string,
  pluginRoot: string,
): ManifestPanel[] | ManifestIssue {
  if (!Array.isArray(value) || value.length > MANIFEST_MAX_PANELS) {
    return issue('invalid-manifest', { field: '/contributes/panels' })
  }
  const panels: ManifestPanel[] = []
  const ids = new Set<string>()
  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index]
    const base = pointer('contributes', 'panels', index)
    if (!isPlainObject(raw)) return issue('invalid-manifest', { field: base })
    const unknown = unknownKeys(raw, ['id', 'title', 'icon', 'location', 'entry'], base)
    if (unknown) return unknown
    if (typeof raw.id !== 'string' || !CONTRIBUTION_ID.test(raw.id)) {
      return issue('invalid-manifest', { field: `${base}/id` })
    }
    if (ids.has(raw.id)) {
      return issue('invalid-manifest', {
        field: `${base}/id`,
        message: 'A panel id may be declared only once.',
      })
    }
    ids.add(raw.id)
    if (!isStringInRange(raw.title, 1, MANIFEST_MAX_VIEW_TITLE)) {
      return issue('invalid-manifest', { field: `${base}/title` })
    }
    if (
      raw.icon !== undefined &&
      (typeof raw.icon !== 'string' ||
        !CODICON.test(raw.icon) ||
        raw.icon.length > MANIFEST_MAX_ICON)
    ) {
      return issue('invalid-manifest', { field: `${base}/icon` })
    }
    if (
      typeof raw.location !== 'string' ||
      !(MANIFEST_PANEL_LOCATIONS as readonly string[]).includes(raw.location)
    ) {
      return issue('invalid-manifest', { field: `${base}/location` })
    }
    if (!hasOwn(raw, 'entry')) {
      return issue('invalid-manifest', { field: `${base}/entry` })
    }
    const entry = resolvePluginEntry(raw.entry, manifestUrl, manifestOrigin, pluginRoot)
    if (!entry.ok) {
      return issue(
        entry.reason === 'permission-denied' ? 'unsupported-origin' : 'invalid-manifest',
        { field: `${base}/entry` },
      )
    }
    panels.push({
      id: raw.id,
      title: raw.title,
      ...(raw.icon === undefined ? {} : { icon: raw.icon }),
      location: raw.location as ManifestPanelLocation,
      entry: raw.entry as string,
      entryUrl: entry.url,
    })
  }
  return panels
}

function parseContentViews(
  value: unknown,
  manifestUrl: string,
  manifestOrigin: string,
  pluginRoot: string,
): ManifestContentView[] | ManifestIssue {
  if (!Array.isArray(value) || value.length > MANIFEST_MAX_CONTENT_VIEWS) {
    return issue('invalid-manifest', { field: '/contributes/contentViews' })
  }
  const views: ManifestContentView[] = []
  const ids = new Set<string>()
  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index]
    const base = pointer('contributes', 'contentViews', index)
    if (!isPlainObject(raw)) return issue('invalid-manifest', { field: base })
    const unknown = unknownKeys(raw, ['id', 'title', 'entry'], base)
    if (unknown) return unknown
    if (typeof raw.id !== 'string' || !CONTRIBUTION_ID.test(raw.id)) {
      return issue('invalid-manifest', { field: `${base}/id` })
    }
    if (ids.has(raw.id)) {
      return issue('invalid-manifest', {
        field: `${base}/id`,
        message: 'A content-view id may be declared only once.',
      })
    }
    ids.add(raw.id)
    if (!isStringInRange(raw.title, 1, MANIFEST_MAX_VIEW_TITLE)) {
      return issue('invalid-manifest', { field: `${base}/title` })
    }
    if (!hasOwn(raw, 'entry')) {
      return issue('invalid-manifest', { field: `${base}/entry` })
    }
    const entry = resolvePluginEntry(raw.entry, manifestUrl, manifestOrigin, pluginRoot)
    if (!entry.ok) {
      return issue(
        entry.reason === 'permission-denied' ? 'unsupported-origin' : 'invalid-manifest',
        { field: `${base}/entry` },
      )
    }
    views.push({
      id: raw.id,
      title: raw.title,
      entry: raw.entry as string,
      entryUrl: entry.url,
    })
  }
  return views
}

/** Validate one setting against its declared type and value limits. */
function validSettingValue(value: unknown, type: ManifestSettingType): value is SettingValue {
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'string') {
    return typeof value === 'string' && value.length <= MANIFEST_MAX_SETTING_STRING
  }
  return typeof value === 'number' && Number.isFinite(value)
}

function parseSetting(value: unknown, base: string): ManifestSetting | ManifestIssue {
  if (!isPlainObject(value)) return issue('invalid-manifest', { field: base })
  const unknown = unknownKeys(value, ['type', 'default', 'enum', 'description', 'scope'], base)
  if (unknown) return unknown
  if (
    !hasOwn(value, 'type') ||
    typeof value.type !== 'string' ||
    !(MANIFEST_SETTING_TYPES as readonly string[]).includes(value.type)
  ) {
    return issue('invalid-manifest', { field: `${base}/type` })
  }
  const type = value.type as ManifestSettingType
  if (!hasOwn(value, 'default') || !validSettingValue(value.default, type)) {
    return issue('invalid-manifest', { field: `${base}/default` })
  }
  const defaultValue = value.default

  let enumValues: SettingValue[] | undefined
  if (hasOwn(value, 'enum')) {
    if (
      type === 'boolean' ||
      !Array.isArray(value.enum) ||
      value.enum.length === 0 ||
      value.enum.length > MANIFEST_MAX_ENUM_VALUES
    ) {
      return issue('invalid-manifest', { field: `${base}/enum` })
    }
    const seen = new Set<SettingValue>()
    for (const item of value.enum) {
      if (!validSettingValue(item, type) || seen.has(item)) {
        return issue('invalid-manifest', { field: `${base}/enum` })
      }
      seen.add(item)
    }
    if (!seen.has(defaultValue)) {
      return issue('invalid-manifest', {
        field: `${base}/enum`,
        message: 'The default must be one of the enum values.',
      })
    }
    enumValues = [...seen]
  }

  if (
    hasOwn(value, 'description') &&
    !isStringInRange(value.description, 1, MANIFEST_MAX_SETTING_DESCRIPTION)
  ) {
    return issue('invalid-manifest', { field: `${base}/description` })
  }

  if (hasOwn(value, 'scope') && value.scope !== 'workspace') {
    return issue('invalid-manifest', { field: `${base}/scope` })
  }

  return {
    type,
    default: defaultValue,
    ...(enumValues ? { enum: enumValues } : {}),
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    scope: 'workspace',
  }
}

function parseConfiguration(value: unknown): ManifestConfiguration | ManifestIssue {
  const base = '/contributes/configuration'
  if (!isPlainObject(value)) return issue('invalid-manifest', { field: base })
  const unknown = unknownKeys(value, ['properties'], base)
  if (unknown) return unknown
  if (!hasOwn(value, 'properties') || !isPlainObject(value.properties)) {
    return issue('invalid-manifest', { field: `${base}/properties` })
  }
  const keys = Object.keys(value.properties)
  if (keys.length > MANIFEST_MAX_SETTINGS) {
    return issue('invalid-manifest', { field: `${base}/properties` })
  }
  const properties: Record<string, ManifestSetting> = {}
  for (const key of keys) {
    const field = pointer('contributes', 'configuration', 'properties', key)
    if (key.length > MANIFEST_MAX_SETTING_KEY || !SETTING_KEY.test(key)) {
      return issue('invalid-manifest', { field })
    }
    const setting = parseSetting(value.properties[key], field)
    if ('code' in setting) return setting
    properties[key] = setting
  }
  return { properties }
}

/** Validate an already-parsed manifest against a final response URL. */
export function validateManifest(
  value: unknown,
  finalUrl: string,
  shellVersion: string,
): ManifestValidationResult {
  if (!isSupportedOriginUrl(finalUrl)) {
    return { ok: false, error: issue('unsupported-origin') }
  }
  let manifestUrl: URL
  try {
    manifestUrl = new URL(finalUrl)
  } catch {
    return { ok: false, error: issue('unsupported-origin') }
  }
  if (manifestUrl.username !== '' || manifestUrl.password !== '') {
    return { ok: false, error: issue('unsupported-origin') }
  }
  if (!isPlainObject(value)) return invalid()

  const unknown = unknownKeys(
    value,
    [
      'schemaVersion',
      'id',
      'name',
      'version',
      'description',
      'publisher',
      'homepage',
      'license',
      'icon',
      'engines',
      'runtime',
      'permissions',
      'contributes',
    ],
    '',
  )
  if (unknown) return { ok: false, error: unknown }

  for (const field of MANIFEST_REQUIRED_FIELDS) {
    if (!hasOwn(value, field)) return invalid(`/${field}`)
  }

  if (value.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    return { ok: false, error: issue('unsupported-version', { field: '/schemaVersion' }) }
  }
  if (typeof value.id !== 'string' || !ID.test(value.id)) return invalid('/id')
  if (!isStringInRange(value.name, 1, MANIFEST_MAX_NAME)) return invalid('/name')
  if (typeof value.version !== 'string' || !SEMVER.test(value.version)) return invalid('/version')
  if (
    hasOwn(value, 'description') &&
    !isStringInRange(value.description, 0, MANIFEST_MAX_DESCRIPTION)
  ) {
    return invalid('/description')
  }

  if (!isPlainObject(value.publisher)) return invalid('/publisher')
  const publisherUnknown = unknownKeys(value.publisher, ['name', 'url'], '/publisher')
  if (publisherUnknown) return { ok: false, error: publisherUnknown }
  if (!isStringInRange(value.publisher.name, 1, MANIFEST_MAX_NAME)) {
    return invalid('/publisher/name')
  }
  if (hasOwn(value.publisher, 'url') && !isHttpsUrl(value.publisher.url)) {
    return invalid('/publisher/url')
  }
  if (hasOwn(value, 'homepage') && !isHttpsUrl(value.homepage)) return invalid('/homepage')
  if (hasOwn(value, 'license') && !isStringInRange(value.license, 1, 256)) {
    return invalid('/license')
  }
  if (hasOwn(value, 'icon') && !(isHttpsUrl(value.icon) || isRelativeAsset(value.icon))) {
    return invalid('/icon')
  }

  if (!isPlainObject(value.engines)) return invalid('/engines')
  const engineUnknown = unknownKeys(value.engines, ['exo'], '/engines')
  if (engineUnknown) return { ok: false, error: engineUnknown }
  if (!isStringInRange(value.engines.exo, 1, 256)) return invalid('/engines/exo')
  if (validRange(value.engines.exo) === null) return invalid('/engines/exo')
  if (!satisfies(shellVersion, value.engines.exo)) {
    return { ok: false, error: issue('incompatible-engine', { field: '/engines/exo' }) }
  }

  if (!isPlainObject(value.runtime)) return invalid('/runtime')
  const runtimeUnknown = unknownKeys(value.runtime, ['entry'], '/runtime')
  if (runtimeUnknown) return { ok: false, error: runtimeUnknown }
  if (typeof value.runtime.entry !== 'string') return invalid('/runtime/entry')
  const controller = resolveController(value.runtime.entry, manifestUrl.href, manifestUrl.origin)
  if (!controller.ok) return { ok: false, error: controller.error }

  const permissions = parsePermissions(value.permissions)
  if (!Array.isArray(permissions)) return { ok: false, error: permissions }

  let fileEditors: ManifestFileEditor[] = []
  let panels: ManifestPanel[] = []
  let contentViews: ManifestContentView[] = []
  let configuration: ManifestConfiguration | undefined
  if (hasOwn(value, 'contributes')) {
    if (!isPlainObject(value.contributes)) return invalid('/contributes')
    const contributesUnknown = unknownKeys(
      value.contributes,
      ['fileEditors', 'panels', 'contentViews', 'configuration'],
      '/contributes',
    )
    if (contributesUnknown) return { ok: false, error: contributesUnknown }
    if (hasOwn(value.contributes, 'fileEditors')) {
      const parsed = parseFileEditors(
        value.contributes.fileEditors,
        manifestUrl.href,
        manifestUrl.origin,
        controller.pluginRoot,
      )
      if (!Array.isArray(parsed)) return { ok: false, error: parsed }
      fileEditors = parsed
    }
    if (hasOwn(value.contributes, 'panels')) {
      const parsed = parsePanels(
        value.contributes.panels,
        manifestUrl.href,
        manifestUrl.origin,
        controller.pluginRoot,
      )
      if (!Array.isArray(parsed)) return { ok: false, error: parsed }
      panels = parsed
    }
    if (hasOwn(value.contributes, 'contentViews')) {
      const parsed = parseContentViews(
        value.contributes.contentViews,
        manifestUrl.href,
        manifestUrl.origin,
        controller.pluginRoot,
      )
      if (!Array.isArray(parsed)) return { ok: false, error: parsed }
      contentViews = parsed
    }
    if (hasOwn(value.contributes, 'configuration')) {
      const parsed = parseConfiguration(value.contributes.configuration)
      if ('code' in parsed) return { ok: false, error: parsed }
      configuration = parsed
    }
  }

  return {
    ok: true,
    manifest: {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      manifestUrl: manifestUrl.href,
      manifestOrigin: manifestUrl.origin,
      controllerUrl: controller.controllerUrl,
      pluginRoot: controller.pluginRoot,
      id: value.id,
      name: value.name,
      version: value.version,
      description: typeof value.description === 'string' ? value.description : undefined,
      publisher: {
        name: value.publisher.name,
        url: typeof value.publisher.url === 'string' ? value.publisher.url : undefined,
      },
      homepage: typeof value.homepage === 'string' ? value.homepage : undefined,
      license: typeof value.license === 'string' ? value.license : undefined,
      icon: typeof value.icon === 'string' ? value.icon : undefined,
      engines: { exo: value.engines.exo },
      permissions,
      fileEditors,
      panels,
      contentViews,
      ...(configuration ? { configuration } : {}),
    },
  }
}

export interface LoadManifestOptions {
  shellOrigin: string
  shellVersion: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  maxBytes?: number
  signal?: AbortSignal
  setTimeoutImpl?: typeof setTimeout
  clearTimeoutImpl?: typeof clearTimeout
}

interface ReadTextResult {
  ok: boolean
  text?: string
  code?: 'too-large' | 'invalid-json'
}

async function readText(response: Response, maxBytes: number): Promise<ReadTextResult> {
  const length = response.headers.get('content-length')
  if (length !== null && Number(length) > maxBytes) {
    return { ok: false, code: 'too-large' }
  }
  let bytes: Uint8Array
  if (!response.body) {
    bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) return { ok: false, code: 'too-large' }
  } else {
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return { ok: false, code: 'too-large' }
      }
      chunks.push(value)
    }
    bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
  }
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch {
    return { ok: false, code: 'invalid-json' }
  }
}

function isJsonContentType(value: string | null): boolean {
  if (!value) return false
  const type = value.split(';', 1)[0].trim().toLowerCase()
  return type === 'application/json' || type.endsWith('+json')
}

/**
 * Fetch and validate one manifest. The returned origin and controller URL come
 * from the final response URL, never from the declared URL.
 */
export async function loadManifest(
  url: string,
  options: LoadManifestOptions,
): Promise<ManifestLoadResult> {
  const requestUrl = (() => {
    try {
      return new URL(url)
    } catch {
      return null
    }
  })()
  if (!requestUrl || !isSupportedOriginUrl(requestUrl.href)) {
    return { ok: false, error: issue('unsupported-origin') }
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? MANIFEST_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? MANIFEST_MAX_BYTES
  const setTimeoutImpl =
    options.setTimeoutImpl ?? (setTimeout.bind(globalThis) as typeof setTimeout)
  const clearTimeoutImpl =
    options.clearTimeoutImpl ?? (clearTimeout.bind(globalThis) as typeof clearTimeout)
  const controller = new AbortController()
  let timedOut = false
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeoutImpl(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  let response: Response
  try {
    try {
      response = await fetchImpl(url, {
        mode: 'cors',
        credentials: 'omit',
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      })
    } catch (error) {
      if (options.signal?.aborted) throw error
      if (timedOut) return { ok: false, error: issue('timeout') }
      const crossOrigin = requestUrl.origin !== options.shellOrigin
      return {
        ok: false,
        error: issue(crossOrigin ? 'cors' : 'network', {
          message: crossOrigin
            ? `Could not fetch ${requestUrl.origin}; a CORS or network failure is possible.`
            : `Could not fetch ${requestUrl.origin}.`,
        }),
      }
    }

    if (!response.ok) {
      return {
        ok: false,
        error: issue('http-status', { status: response.status }),
      }
    }
    if (!isJsonContentType(response.headers.get('content-type'))) {
      return {
        ok: false,
        error: issue('invalid-manifest', { message: 'Expected a JSON content type.' }),
      }
    }

    const finalUrl = response.url || url
    if (!isSupportedOriginUrl(finalUrl)) {
      return { ok: false, error: issue('unsupported-origin') }
    }

    let text: ReadTextResult
    try {
      text = await readText(response, maxBytes)
    } catch (error) {
      if (options.signal?.aborted) throw error
      if (timedOut) return { ok: false, error: issue('timeout') }
      return { ok: false, error: issue('network') }
    }
    if (!text.ok) {
      return { ok: false, error: issue(text.code ?? 'invalid-json') }
    }

    let value: unknown
    try {
      value = JSON.parse(text.text ?? '')
    } catch {
      return { ok: false, error: issue('invalid-json') }
    }
    return validateManifest(value, finalUrl, options.shellVersion)
  } finally {
    clearTimeoutImpl(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}
