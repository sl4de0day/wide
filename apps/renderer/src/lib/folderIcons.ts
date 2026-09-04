

const BLUE = "#81a1c1";
const CYAN = "#88c0d0";
const TEAL = "#8fbcbb";
const GREEN = "#a3be8c";
const YELLOW = "#ebcb8b";
const ORANGE = "#d08770";
const RED = "#bf616a";
const PURPLE = "#b48ead";
const DIM = "#6d7a91";
const DEFAULT = "#7b88a1";

const BY_NAME: Readonly<Record<string, string>> = {

  "src": BLUE, "source": BLUE, "sources": BLUE, "app": BLUE, "apps": BLUE,
  "main": BLUE, "core": BLUE,

  "types": BLUE, "@types": BLUE, "typings": BLUE, "interfaces": BLUE,

  "lib": CYAN, "libs": CYAN, "shared": CYAN, "common": CYAN, "utils": CYAN,
  "util": CYAN, "utilities": CYAN, "helpers": CYAN, "helper": CYAN,
  "hooks": CYAN, "hook": CYAN, "functions": CYAN,

  "components": PURPLE, "component": PURPLE, "ui": PURPLE, "widgets": PURPLE,
  "views": PURPLE, "view": PURPLE, "pages": PURPLE, "page": PURPLE,
  "screens": PURPLE, "layouts": PURPLE, "layout": PURPLE, "elements": PURPLE,
  "partials": PURPLE,

  "store": PURPLE, "stores": PURPLE, "state": PURPLE, "redux": PURPLE,
  "context": PURPLE, "contexts": PURPLE, "providers": PURPLE,
  "reducers": PURPLE, "actions": PURPLE,

  "images": PURPLE, "image": PURPLE, "img": PURPLE, "imgs": PURPLE,
  "media": PURPLE, "pictures": PURPLE, "photos": PURPLE,

  "public": TEAL, "static": TEAL, "assets": TEAL, "asset": TEAL, "res": TEAL,
  "resources": TEAL,

  "i18n": TEAL, "locales": TEAL, "locale": TEAL, "lang": TEAL, "langs": TEAL,
  "languages": TEAL, "translations": TEAL, "intl": TEAL,

  "icons": YELLOW, "icon": YELLOW,

  "styles": ORANGE, "style": ORANGE, "css": ORANGE, "scss": ORANGE,
  "sass": ORANGE, "less": ORANGE, "stylesheets": ORANGE, "fonts": ORANGE,
  "font": ORANGE,

  "test": YELLOW, "tests": YELLOW, "__tests__": YELLOW, "__test__": YELLOW,
  "spec": YELLOW, "specs": YELLOW, "e2e": YELLOW, "cypress": YELLOW,
  "__mocks__": YELLOW, "mocks": YELLOW, "fixtures": YELLOW,

  "api": GREEN, "apis": GREEN, "server": GREEN, "backend": GREEN,
  "services": GREEN, "service": GREEN, "controllers": GREEN,
  "controller": GREEN, "routes": GREEN, "route": GREEN, "router": GREEN,
  "middleware": GREEN, "middlewares": GREEN, "handlers": GREEN,

  "scripts": GREEN, "script": GREEN, "tools": GREEN, "tool": GREEN,
  "tasks": GREEN,

  "content": GREEN, "posts": GREEN, "blog": GREEN, "articles": GREEN,

  "db": ORANGE, "database": ORANGE, "data": ORANGE, "migrations": ORANGE,
  "migration": ORANGE, "models": ORANGE, "model": ORANGE, "schema": ORANGE,
  "schemas": ORANGE, "prisma": ORANGE, "sql": ORANGE, "seeders": ORANGE,
  "seeds": ORANGE,

  ".git": RED,

  "dist": DIM, "build": DIM, "out": DIM, "output": DIM, "release": DIM,
  "target": DIM, "bin": DIM, "obj": DIM, "coverage": DIM, ".next": DIM,
  ".nuxt": DIM, ".output": DIM, ".cache": DIM, "cache": DIM, "tmp": DIM,
  "temp": DIM, "node_modules": DIM, "vendor": DIM, "bower_components": DIM,
  "packages": DIM, "deps": DIM,

  "config": DIM, "configs": DIM, ".config": DIM, "settings": DIM,
  ".vscode": DIM, ".idea": DIM, ".devcontainer": DIM, ".husky": DIM,
  ".github": DIM, ".gitlab": DIM, ".circleci": DIM,

  "docs": DIM, "doc": DIM, "documentation": DIM, "examples": DIM,
  "example": DIM, "demo": DIM, "demos": DIM,
};

export function folderColour(name: string): string {
  return BY_NAME[name.toLowerCase()] ?? DEFAULT;
}
