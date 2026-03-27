import { Template, defaultBuildLogger } from "e2b"
import { template } from "./template"

const TEMPLATE_NAME = process.env.E2B_TEMPLATE_NAME ?? "doodle-sandbox"
const CPU_COUNT = Number(process.env.E2B_TEMPLATE_CPU ?? "2")
const MEMORY_MB = Number(process.env.E2B_TEMPLATE_MEMORY_MB ?? "4096")

function assertApiKey() {
  if (!process.env.E2B_API_KEY) {
    throw new Error("E2B_API_KEY is missing. Run with fnox exec.")
  }
}

async function main() {
  assertApiKey()

  if (!Number.isFinite(CPU_COUNT) || CPU_COUNT < 1) {
    throw new Error("E2B_TEMPLATE_CPU must be >= 1")
  }

  if (!Number.isFinite(MEMORY_MB) || MEMORY_MB < 512) {
    throw new Error("E2B_TEMPLATE_MEMORY_MB must be >= 512")
  }

  console.log(`Building template: ${TEMPLATE_NAME}`)
  console.log(`Resources: ${CPU_COUNT} CPU, ${MEMORY_MB} MB RAM`)

  const build = await Template.build(template, TEMPLATE_NAME, {
    cpuCount: CPU_COUNT,
    memoryMB: MEMORY_MB,
    onBuildLogs: defaultBuildLogger(),
  })

  console.log("Template build complete")
  console.log(`- Name: ${build.name}`)
  console.log(`- Alias: ${build.alias}`)
  console.log(`- Tags: ${build.tags.join(", ") || "(none)"}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
