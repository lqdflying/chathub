export * from './mcp';
export * from './plugins';

export enum DiscoverTab {
  Home = 'home',
  Mcp = 'mcp',
  Plugins = 'plugin',
}

export type IdentifiersResponse = {
  identifier: string;
  lastModified: string;
}[];

export enum CacheTag {
  Discover = 'discover',
  MCP = 'mcp',
  Plugins = 'plugins',
}

export enum CacheRevalidate {
  List = 3600,
  Details = 43_200,
}
