import RE2 from 're2';

import { CrawlUrlRule } from '../type';

/**
 * Matches a string against a regex pattern using RE2 (Google's linear-time engine).
 * RE2 guarantees O(n) matching and never backtracks catastrophically, making it
 * safe to call with user/admin-supplied patterns without any timeout sandbox.
 */
const safeRegexMatch = (pattern: string, input: string): RegExpMatchArray | null => {
  try {
    return new RE2(pattern).exec(input);
  } catch (e) {
    console.warn('[safeRegexMatch] Invalid or unsupported regex pattern:', pattern, e);
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
