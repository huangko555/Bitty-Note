declare module "lucide/dist/esm/createElement.mjs" {
  type IconNode = [string, Record<string, string>][];
  export default function createElement(
    icon: IconNode,
    attributes?: Record<string, string>,
  ): SVGElement;
}

declare module "lucide/dist/esm/icons/*.mjs" {
  const icon: [string, Record<string, string>][];
  export default icon;
}
