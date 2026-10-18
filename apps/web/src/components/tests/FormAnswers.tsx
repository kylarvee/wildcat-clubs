import "server-only";
import type { QuestionType } from "@prisma/client";
import { MinusCircle } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { RichContent } from "@/components/rich/RichContent";
import { hasText } from "@/lib/tests/scoring";
import { isChoice, type QuestionOption } from "@/lib/tests/types";

export type FormAnswerItem = { questionId: string; type: QuestionType; promptHtml: string; options: (QuestionOption & { picked: boolean })[]; text: string | null };

/**
 * A form response, read-only: each question with the answer given. Nothing is
 * graded, so there are no points or right and wrong. Shown to the person who
 * filled it out and, on the Responses page, to the people who manage it.
 */
export function FormAnswers({ items, answerLabel = "Your answer" }: { items: FormAnswerItem[]; answerLabel?: string }) {
  return (
    <ol className="space-y-4">
      {items.map((it, i) => {
        const picked = it.options.filter((o) => o.picked);
        const blank = isChoice(it.type) ? picked.length === 0 : !hasText(it.text);
        return (
          <li key={it.questionId}>
            <Card>
              <CardBody className="space-y-3">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-3">Question {i + 1}</p>
                <RichContent html={it.promptHtml} />
                <div className="rounded-xl bg-muted/50 px-3 py-2.5">
                  <p className="mb-1 text-xs font-medium text-ink-3">{answerLabel}</p>
                  {blank ? (
                    <p className="flex items-center gap-1.5 text-sm text-ink-3">
                      <MinusCircle className="h-4 w-4" aria-hidden /> No answer
                    </p>
                  ) : isChoice(it.type) ? (
                    <ul className="space-y-1">
                      {picked.map((o) => (
                        <li key={o.id} className="text-sm text-ink">
                          {o.text}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <RichContent html={it.text} className="text-sm" />
                  )}
                </div>
              </CardBody>
            </Card>
          </li>
        );
      })}
    </ol>
  );
}
