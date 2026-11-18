export type StudyStage = 'shelf' | 'course' | 'classroom'

/** 没有详情时，先看书架；选了课程才进课程目录；打开一讲才进课堂。 */
export function studyStage(input: { detail: boolean; activeCourse: boolean }): StudyStage {
  if (input.detail) return 'classroom'
  return input.activeCourse ? 'course' : 'shelf'
}

/** 书架上的“继续上次”只看最近更新的一条，不按课程或导入顺序猜。 */
export function latestSession<T extends { updatedAt: string }>(sessions: T[]): T | null {
  let latest: T | null = null
  for (const session of sessions) {
    if (!latest || Date.parse(session.updatedAt) > Date.parse(latest.updatedAt)) latest = session
  }
  return latest
}

/** 课程页只说这门课一共多少讲，不把每份课件的数字重复成一行按钮。 */
export function studyUnitCount(course: { sessions: Array<{ unitCount: number }> } | null): number {
  if (!course) return 0
  return course.sessions.reduce((sum, session) => sum + session.unitCount, 0)
}
