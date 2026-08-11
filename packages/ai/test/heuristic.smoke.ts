// Smoke test for the manual (heuristic) engines — runs with zero AI calls,
// zero network, zero env vars. `npx tsx packages/ai/test/heuristic.smoke.ts`
import { heuristicAtsSimulation, heuristicMatchScore } from "../src/heuristic/index.js";
import { MatchScoreSchema, AtsSimulationSchema, type Listing, type MasterResume } from "@aperture/shared";

const profile: MasterResume = {
  basics: {
    name: "Test Candidate",
    email: "test@example.com",
    phone: null,
    location: "Toronto, ON",
    headline: "Embedded systems engineer",
    links: [],
  },
  summary: "Embedded engineer with drone and edge AI experience.",
  experience: [
    {
      company: "Acme Robotics",
      title: "Embedded Systems Engineer",
      start: "2023-01",
      end: null,
      location: "Toronto",
      bullets: [
        "Built MAVLink telemetry pipeline for drone fleet in C++ and Python",
        "Deployed PyTorch models to edge devices, cutting inference latency 40%",
      ],
      skills: ["c++", "python", "mavlink", "pytorch"],
    },
  ],
  projects: [
    {
      name: "Fieldfare",
      url: null,
      description: "Drone protocol tooling",
      bullets: ["Implemented MAVLink parsing and replay"],
      skills: ["drone protocols", "mavlink", "rust"],
    },
  ],
  education: [],
  skills: [
    { name: "python", category: "language", level: "advanced", evidence: [] },
    { name: "pytorch", category: "ml", level: "intermediate", evidence: [] },
    { name: "mavlink", category: "domain", level: "advanced", evidence: [] },
  ],
  certifications: [],
  publications: [],
  awards: [],
  targetRoles: ["embedded engineer", "robotics engineer"],
};

const listing: Listing = {
  id: "test",
  source: "manual",
  url: "https://example.com/job",
  title: "Senior Embedded Engineer",
  company: "DroneCo",
  location: "Remote",
  salary: null,
  description:
    "We need 3+ years experience with embedded systems, C++, Python, and RTOS. " +
    "Experience with MAVLink, ROS, and Kubernetes preferred. PyTorch a plus.",
  postedAt: null,
};

const ats = heuristicAtsSimulation(profile, listing);
AtsSimulationSchema.parse(ats); // engines must satisfy the same contract as AI
console.log("ATS:", ats.score, ats.likelyOutcome);
console.log("  matched:", ats.matchedKeywords.join(", "));
console.log("  missing:", ats.missingKeywords.join(", "));

const match = heuristicMatchScore(profile, listing);
MatchScoreSchema.parse(match);
console.log("Match:", match.overall, match.verdict, JSON.stringify(match.subscores));

if (ats.matchedKeywords.length === 0) throw new Error("expected keyword matches");
if (!ats.missingKeywords.includes("kubernetes")) throw new Error("expected kubernetes as a gap");
console.log("heuristic smoke: OK");
