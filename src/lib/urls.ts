export function basePath() {
  return import.meta.env.BASE_URL.replace(/\/$/, '')
}
export function assetUrl(name: string) {
  return `${basePath()}/${name.replace(/^\//, '')}`
}
export function appUrl(path: string) {
  return `${window.location.origin}${basePath()}/${path.replace(/^\//, '')}`
}
