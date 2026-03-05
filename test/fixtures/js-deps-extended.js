import { core } from "core-js";
export { readFile } from "node:fs";
export * from "./local-reexport";

const lazy = import("./lazy");
const pkg = import("@scope/dynamic");
