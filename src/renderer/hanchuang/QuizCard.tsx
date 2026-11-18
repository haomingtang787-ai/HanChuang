import { useState } from 'react'
import type { StudyArtifact, StudyQuizAnswer } from '../../shared/study'
import { RichText } from './RichText'

type Props = {
  artifact: StudyArtifact
  busy: boolean
  onGrade: (answers: StudyQuizAnswer[]) => void
}

/** 题测卡片：出题 → 逐题作答 → 交卷判分 → 每题对错与讲解。 */
export function QuizCard({ artifact, busy, onGrade }: Props) {
  const questions = artifact.body.questions ?? []
  const graded = Boolean(artifact.body.graded)
  const results = artifact.body.results ?? []
  const saved = artifact.body.answers ?? []
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(saved.map((item) => [item.questionId, item.answer])),
  )
  if (questions.length === 0) return null
  const allAnswered = questions.every((question) => (answers[question.id] ?? '').trim() !== '')
  return (
    <div className="hc-quiz">
      <div className="hc-card-title">课堂小测{graded ? ' · 已判分' : ''}</div>
      {questions.map((question, index) => {
        const result = graded ? results.find((item) => item.index === index + 1) : undefined
        const mine = graded
          ? saved.find((item) => item.questionId === question.id)?.answer ?? ''
          : answers[question.id] ?? ''
        return (
          <div key={question.id} className="hc-quiz-q">
            <div className="hc-quiz-prompt">{index + 1}. <RichText text={question.prompt} className="hc-rich hc-rich-inline" /></div>
            {question.hint !== '' && <div className="hc-quiz-hint">提示：{question.hint}</div>}
            {graded ? (
              <div className="hc-quiz-graded">
                <div className="hc-quiz-my">你的答案：{mine === '' ? '（未作答）' : mine}</div>
                {result && (
                  <div className={result.correct ? 'hc-quiz-right' : 'hc-quiz-wrong'}>
                    {result.correct ? '答对了' : '这题错了，已进错题本'} · {result.explain}
                  </div>
                )}
              </div>
            ) : (
              <textarea
                rows={2}
                value={answers[question.id] ?? ''}
                placeholder="写下你的答案"
                onChange={(event) => setAnswers((prev) => ({ ...prev, [question.id]: event.target.value }))}
              />
            )}
          </div>
        )
      })}
      {!graded && (
        <button
          className="hc-primary"
          disabled={busy || !allAnswered}
          onClick={() => onGrade(questions.map((question) => ({ questionId: question.id, answer: (answers[question.id] ?? '').trim() })))}
        >
          交卷判分
        </button>
      )}
      {graded && artifact.body.feedback && <RichText text={artifact.body.feedback} />}
    </div>
  )
}