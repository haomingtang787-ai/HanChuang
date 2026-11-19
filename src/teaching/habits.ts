export type Pace = "slow" | "steady" | "exam";
export type TeachStyle = "story" | "define" | "ask";
export type StudyWindow = "morning" | "afternoon" | "evening" | "night";
export type Avoid = "formula" | "long" | "noexample";

export type Habits = {
  name: string;
  pace: Pace;
  style: TeachStyle;
  minutes: 15 | 25 | 40;
  window: StudyWindow;
  avoid: Avoid;
  /** 学生自己写的一句话习惯；没写就留空。预设项只作为老数据兼容保留。 */
  note?: string;
};

export const MAX_NAME = 16;
export const MAX_NOTE = 160;

export const DEFAULT_HABITS: Habits = {
  name: "",
  pace: "steady",
  style: "story",
  minutes: 25,
  window: "evening",
  avoid: "long",
  note: "",
};

export const PACE_OPTIONS: { id: Pace; label: string }[] = [
  { id: "slow", label: "讲透" },
  { id: "steady", label: "适中" },
  { id: "exam", label: "抓考点" },
];

export const STYLE_OPTIONS: { id: TeachStyle; label: string }[] = [
  { id: "story", label: "先比方" },
  { id: "define", label: "先定义" },
  { id: "ask", label: "先提问" },
];

export const MINUTE_OPTIONS: { id: 15 | 25 | 40; label: string }[] = [
  { id: 15, label: "15 分钟" },
  { id: 25, label: "25 分钟" },
  { id: 40, label: "40 分钟" },
];

export const AVOID_OPTIONS: { id: Avoid; label: string }[] = [
  { id: "formula", label: "公式堆着" },
  { id: "long", label: "段落太长" },
  { id: "noexample", label: "没有例子" },
];

/** 时段只在排课日期标签里用（今晚/明晚），不再作为可选项暴露给用户。 */
export function windowLabel(window: StudyWindow): string {
  if (window === "morning") return "早上";
  if (window === "afternoon") return "下午";
  if (window === "night") return "睡前";
  return "晚上";
}

export function styleLabel(style: TeachStyle): string {
  if (style === "define") return "先定义";
  if (style === "ask") return "先提问";
  return "先比方";
}

export function habitStamp(h: Habits): string {
  return [h.pace, h.style, String(h.minutes), h.window, h.avoid, h.name.trim()].join("|");
}

export function sanitizeHabits(input: unknown): Habits {
  const raw = input && typeof input === "object" ? (input as Partial<Habits>) : {};
  const minutes = raw.minutes === 15 || raw.minutes === 40 ? raw.minutes : 25;
  const pace: Pace = raw.pace === "slow" || raw.pace === "exam" ? raw.pace : "steady";
  const style: TeachStyle =
    raw.style === "define" || raw.style === "ask" ? raw.style : "story";
  const window: StudyWindow =
    raw.window === "morning" || raw.window === "afternoon" || raw.window === "night"
      ? raw.window
      : "evening";
  const avoid: Avoid =
    raw.avoid === "formula" || raw.avoid === "noexample" ? raw.avoid : "long";
  const name =
    typeof raw.name === "string" ? raw.name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME) : "";
  const note =
    typeof raw.note === "string" ? raw.note.replace(/\r/g, "").trim().slice(0, MAX_NOTE) : "";
  return { name, pace, style, minutes, window, avoid, note };
}

export function remembers(h: Habits, slowTaps: number): string {
  const name = h.name.trim();
  const head = name ? `${name}，我按你的习惯来。` : "我按你的习惯来。";
  const pace =
    h.pace === "slow"
      ? "你希望讲透，我会把每句的条件都停一下。"
      : h.pace === "exam"
        ? "你想先抓会考的，必考的放前面，句子仍然讲完。"
        : "节奏放在适中，不赶，也不把一句拆得太碎。";
  const style =
    h.style === "define"
      ? "你喜欢先听到定义。"
      : h.style === "ask"
        ? "你喜欢先被问一句，再听我讲明白。"
        : "你喜欢先有一个比方，再回到定义。";
  const avoid =
    h.avoid === "formula"
      ? "公式堆在一起会让你累，我会把符号说成人话。"
      : h.avoid === "noexample"
        ? "没有例子你不容易记住，核心的地方我会补一个算得完的例子。"
        : "长段落会让你走神，所以我拆成小讲。";
  const slow = slowTaps >= 2 ? "你连续让我放慢，进度就改成每天一小讲。" : "";
  return `${head}每次大约 ${h.minutes} 分钟。${pace}${style}${avoid}${slow}`;
}

export function habitBrief(h: Habits): string {
  const name = h.name.trim();
  const note = (h.note ?? '').replace(/\s+/g, ' ').trim();
  return [
    name ? `学生希望被称呼为「${name}」。全文最多称呼两次。` : "学生没有留名字，用「你」，不要编造姓名。",
    note
      ? `学生自己写的学习习惯（以这段为唯一依据，不要替他改口、不要自己加戏）：${note}`
      : "学生没写学习习惯：不要假设他的偏好，按默认讲法来——先给定义，再举一个能算完的例子，最后点出最容易被误解的地方。",
  ].join("");
}
