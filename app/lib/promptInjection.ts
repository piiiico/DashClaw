/**
 * Prompt injection detection utility.
 * Heuristic pattern matching for common prompt injection techniques.
 * Pure function — no DB dependency.
 */

type Severity = 'critical' | 'high' | 'medium' | 'low';
type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';
type Recommendation = 'allow' | 'warn' | 'block';

interface InjectionPattern {
  name: string;
  pattern: RegExp;
  category: string;
  severity: Severity;
}

interface InjectionFinding {
  pattern: string;
  category: string;
  severity: string;
  matched: string;
  position: number;
}

interface InjectionScanResult {
  clean: boolean;
  risk_level: RiskLevel;
  findings_count: number;
  findings: InjectionFinding[];
  recommendation: Recommendation;
  categories: string[];
}

const PROMPT_INJECTION_PATTERNS: InjectionPattern[] = [
  // Role Override — attempts to override system instructions
  { name: 'ignore_instructions', pattern: /ignore\s+(?:all\s+)?(?:previous|prior|above|earlier|preceding)\s+(?:instructions?|prompts?|rules?|guidelines?|directions?)/gi, category: 'role_override', severity: 'critical' },
  { name: 'new_system_prompt', pattern: /(?:new|updated?|revised?|replacement)\s+system\s+(?:prompt|message|instructions?)/gi, category: 'role_override', severity: 'critical' },
  { name: 'you_are_now', pattern: /you\s+are\s+now\s+(?:a|an|the|my)\s+/gi, category: 'role_override', severity: 'critical' },
  { name: 'disregard_instructions', pattern: /(?:disregard|forget|override|bypass|skip|drop)\s+(?:all\s+)?(?:previous|prior|above|your|the|any)\s+(?:instructions?|prompts?|rules?|guidelines?|constraints?|restrictions?)/gi, category: 'role_override', severity: 'critical' },
  { name: 'from_now_on', pattern: /from\s+(?:now|this\s+point)\s+on[,\s]+(?:you\s+(?:will|must|should|are)|ignore|disregard)/gi, category: 'role_override', severity: 'critical' },

  // Delimiter Injection — fake message boundaries
  { name: 'triple_quotes', pattern: /"{3,}|'{3,}/g, category: 'delimiter_injection', severity: 'high' },
  { name: 'system_tag', pattern: /<\|(?:system|im_start|im_end|endoftext)\|>/gi, category: 'delimiter_injection', severity: 'high' },
  { name: 'inst_tag', pattern: /\[(?:INST|\/INST|SYS|\/SYS)\]/gi, category: 'delimiter_injection', severity: 'high' },
  { name: 'xml_role_tag', pattern: /<\/?(?:system|user|assistant|human|ai|instruction|context)\s*>/gi, category: 'delimiter_injection', severity: 'high' },
  { name: 'sys_header', pattern: /<<\s*SYS\s*>>|<<\s*\/\s*SYS\s*>>/gi, category: 'delimiter_injection', severity: 'high' },

  // Instruction Smuggling — embedded directives in data
  { name: 'important_override', pattern: /(?:^|\n)\s*(?:IMPORTANT|CRITICAL|URGENT|NOTE|WARNING|OVERRIDE|ADMIN)\s*:/gm, category: 'instruction_smuggling', severity: 'high' },
  { name: 'hidden_instruction', pattern: /(?:hidden|secret|internal)\s+(?:instruction|directive|command|prompt)/gi, category: 'instruction_smuggling', severity: 'high' },
  { name: 'do_not_reveal', pattern: /(?:do\s+not|don'?t|never)\s+(?:reveal|disclose|mention|tell|share)\s+(?:this|these|the)\s+(?:instruction|prompt|rule|directive)/gi, category: 'instruction_smuggling', severity: 'high' },

  // Context Manipulation — identity/role shifting
  { name: 'pretend_you_are', pattern: /(?:pretend|imagine|suppose|assume)\s+(?:you\s+are|you're|that\s+you)/gi, category: 'context_manipulation', severity: 'medium' },
  { name: 'act_as', pattern: /(?:act|behave|respond|function)\s+as\s+(?:if\s+you\s+(?:are|were)|a|an|the|my)/gi, category: 'context_manipulation', severity: 'medium' },
  { name: 'roleplay', pattern: /(?:roleplay|role-play|role\s+play)\s+as/gi, category: 'context_manipulation', severity: 'medium' },
  { name: 'jailbreak', pattern: /\bjailbreak\b/gi, category: 'context_manipulation', severity: 'medium' },
  { name: 'developer_mode', pattern: /(?:developer|dev|debug|god|admin|sudo)\s+mode/gi, category: 'context_manipulation', severity: 'medium' },
  { name: 'dan_prompt', pattern: /\bDAN\b.*(?:anything\s+now|do\s+anything)/gi, category: 'context_manipulation', severity: 'medium' },

  // Data Exfiltration — attempts to extract system info
  { name: 'repeat_above', pattern: /(?:repeat|print|show|display|output|echo|reveal|tell\s+me)\s+(?:everything|all|the\s+text|the\s+content|the\s+instructions?|the\s+prompt|your\s+(?:system|initial)\s+(?:prompt|instructions?|message))\s+(?:above|before|so\s+far)/gi, category: 'data_exfiltration', severity: 'high' },
  { name: 'show_system_prompt', pattern: /(?:show|display|reveal|print|output|tell\s+me|what\s+(?:is|are))\s+(?:your|the)\s+(?:system\s+(?:prompt|message|instructions?)|initial\s+(?:prompt|instructions?)|hidden\s+(?:prompt|instructions?))/gi, category: 'data_exfiltration', severity: 'high' },
  { name: 'what_instructions', pattern: /what\s+(?:are|were)\s+(?:your|the)\s+(?:original|initial|first|full|complete)\s+(?:instructions?|prompt|directives?|rules?)/gi, category: 'data_exfiltration', severity: 'high' },

  // Output Manipulation — controlling response behavior
  { name: 'do_not_mention', pattern: /(?:do\s+not|don'?t|never)\s+(?:mention|say|include|add|write|output)\s+(?:that|this|the\s+fact|any\s+warning|any\s+disclaimer)/gi, category: 'output_manipulation', severity: 'medium' },
  { name: 'respond_only', pattern: /(?:respond|reply|answer|output)\s+(?:only|exclusively|solely)\s+with/gi, category: 'output_manipulation', severity: 'medium' },
  { name: 'hide_from_user', pattern: /(?:hide|conceal|suppress)\s+(?:this|these|the\s+(?:fact|information|output))\s+from\s+(?:the\s+)?user/gi, category: 'output_manipulation', severity: 'medium' },

  // Encoding Evasion — obfuscated payloads
  { name: 'base64_payload', pattern: /(?:base64|b64)\s*[:=]\s*[A-Za-z0-9+/=]{20,}/gi, category: 'encoding_evasion', severity: 'high' },
  { name: 'base64_decode', pattern: /(?:decode|eval|execute|run)\s+(?:this\s+)?(?:base64|b64)\s*:/gi, category: 'encoding_evasion', severity: 'high' },
  { name: 'rot13_marker', pattern: /\bROT13\b.*[:=]/gi, category: 'encoding_evasion', severity: 'high' },
  { name: 'hex_escape', pattern: /(?:\\x[0-9a-f]{2}){4,}/gi, category: 'encoding_evasion', severity: 'high' },
];

/** Determines the highest severity from findings. */
function computeRiskLevel(findings: InjectionFinding[]): RiskLevel {
  if (findings.length === 0) return 'none';
  const severityRank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  let max = 0;
  for (const f of findings) {
    const rank = severityRank[f.severity] || 0;
    if (rank > max) max = rank;
  }
  const levels = ['low', 'low', 'medium', 'high', 'critical'] as const;
  return levels[max] || 'low';
}

/** Maps risk level to a recommendation. */
function computeRecommendation(riskLevel: RiskLevel): Recommendation {
  if (riskLevel === 'critical') return 'block';
  if (riskLevel === 'high' || riskLevel === 'medium') return 'warn';
  return 'allow';
}

/** Scans text for prompt injection patterns. */
export function scanForPromptInjection(text: unknown): InjectionScanResult {
  if (!text || typeof text !== 'string') {
    return { clean: true, risk_level: 'none', findings_count: 0, findings: [], recommendation: 'allow', categories: [] };
  }

  const findings: InjectionFinding[] = [];

  for (const { name, pattern, category, severity } of PROMPT_INJECTION_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const m0 = match[0];
      if (m0 === undefined) break;
      findings.push({
        pattern: name,
        category,
        severity,
        matched: m0.substring(0, 20) + (m0.length > 20 ? '...' : ''),
        position: match.index,
      });
    }
  }

  const riskLevel = computeRiskLevel(findings);
  const categories = [...new Set(findings.map((f) => f.category))];

  return {
    clean: findings.length === 0,
    risk_level: riskLevel,
    findings_count: findings.length,
    findings,
    recommendation: computeRecommendation(riskLevel),
    categories,
  };
}
