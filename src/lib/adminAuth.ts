/** 当前是否为管理页路由:URL 路径最后一段是 management(兼容子路径部署与尾斜杠) */
export function isManagementPath(pathname: string = window.location.pathname): boolean {
  const segments = pathname.split('/').filter(Boolean);
  return segments[segments.length - 1] === 'management';
}
