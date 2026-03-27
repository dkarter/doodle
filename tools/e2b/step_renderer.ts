type StepStatus = "running" | "done" | "failed"

export class StepRenderer {
  private readonly enabled = Boolean(process.stdout.isTTY)
  private readonly maxActiveLogs = 7
  private renderedLines = 0
  private steps: Array<{ title: string; status: StepStatus }> = []
  private activeLogs: string[] = []

  startStep(title: string) {
    if (!this.enabled) {
      console.log(`- ${title}...`)
      return
    }

    this.steps.push({ title, status: "running" })
    this.activeLogs = []
    this.render()
  }

  finishStep(status: Exclude<StepStatus, "running">) {
    if (!this.enabled) {
      const current = this.steps.at(-1)
      if (current) {
        console.log(`- ${current.title} ${status.toUpperCase()}`)
      }
      return
    }

    const current = this.steps.at(-1)
    if (current) {
      current.status = status
    }
    this.activeLogs = []
    this.render()
  }

  appendLog(line: string, isError = false) {
    if (!this.enabled) return
    if (this.steps.length === 0) return

    const text = line.trim()
    if (!text) return

    const color = isError ? "\x1b[31m" : "\x1b[90m"
    this.activeLogs.push(`${color}${text}\x1b[0m`)
    if (this.activeLogs.length > this.maxActiveLogs) {
      this.activeLogs = this.activeLogs.slice(-this.maxActiveLogs)
    }
    this.render()
  }

  private render() {
    if (!this.enabled) return

    const lines: string[] = []
    for (const step of this.steps) {
      const badge =
        step.status === "done"
          ? "\x1b[32mDONE\x1b[0m"
          : step.status === "failed"
            ? "\x1b[31mFAILED\x1b[0m"
            : "\x1b[33m...\x1b[0m"
      lines.push(`${step.title} ${badge}`)
    }

    lines.push(...this.activeLogs)

    if (this.renderedLines > 0) {
      process.stdout.write(`\x1b[${this.renderedLines}A\r\x1b[J`)
    }

    process.stdout.write(`${lines.join("\n")}\n`)
    this.renderedLines = lines.length
  }
}
