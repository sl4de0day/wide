import { bridge } from "@/lib/bridge";
import type { WappalyzerRuleset } from "@/lib/wappalyzer";

let cache: WappalyzerRuleset | null = null;
let promise: Promise<WappalyzerRuleset | null> | null = null;

export function loadWappalyzerRuleset(): Promise<WappalyzerRuleset | null> {
  if (cache) return Promise.resolve(cache);
  if (promise) return promise;
  promise = bridge.webtoolsWappalyzer().then((reply) => {
    if (reply.ok && reply.technologies) {
      cache = {
        technologies: reply.technologies as WappalyzerRuleset["technologies"],
        categories: (reply.categories ?? {}) as WappalyzerRuleset["categories"],
      };
      return cache;
    }
    promise = null;
    return null;
  });
  return promise;
}
