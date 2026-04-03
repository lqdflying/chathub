import vm from 'node:vm';

import { CrawlUrlRule } from '../type';

/**
 * Safely matches a string against a regex pattern with a timeout to prevent ReDoS.
 * urlPattern is user/admin-configurable, so we run the match inside a VM context
 * with a time limit to guard against catastrophic backtracking.
 */
const safeRegexMatch = (
  pattern: string,
  input: string,
  timeoutMs = 100,
): RegExpMatchArray | null => {
  try {
    const script = new vm.Script('input.match(re)');
    const context = vm.createContext({ input, re: new RegExp(pattern) });
    return script.runInContext(context, { timeout: timeoutMs }) as RegExpMatchArray | null;
  } catch {
    return null;
  }
};

export const applyUrlRules = (
  url: string,
  urlRules: CrawlUrlRule[],
): {
  filterOptions?: CrawlUrlRule['filterOptions'];
  impls?: string[];
  transformedUrl: string;
} => {
  for (const rule of urlRules) {
    const match = safeRegexMatch(rule.urlPattern, url);

    if (match) {
      if (rule.urlTransform) {
        // 如果有转换规则，进行 URL 转换
        // 替换 $1, $2 等占位符为捕获组内容
        const transformedUrl = rule.urlTransform.replaceAll(
          /\$(\d+)/g,
          (_, index) => match[parseInt(index)] || '',
        );

        return {
          filterOptions: rule.filterOptions,
          impls: rule.impls,
          transformedUrl,
        };
      } else {
        // 没有转换规则但匹配了模式，只返回过滤选项
        return {
          filterOptions: rule.filterOptions,
          impls: rule.impls,
          transformedUrl: url,
        };
      }
    }
  }

  // 没有匹配任何规则，返回原始 URL
  return { transformedUrl: url };
};
