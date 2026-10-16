"use client";

import { useTransition, type FormEvent } from "react";

/**
 * Submit handler for forms whose server action can return a validation error.
 * Unlike <form action>, React doesn't auto-reset the fields afterwards, so
 * people keep what they typed when something needs fixing. Call form.reset()
 * yourself on success when you want a blank form.
 */
export function useFormSubmit(handler: (fd: FormData, form: HTMLFormElement) => Promise<unknown>) {
  const [pending, start] = useTransition();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    start(async () => {
      await handler(fd, form);
    });
  };
  return { pending, onSubmit };
}
