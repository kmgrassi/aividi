# Character Consistency Generation Scope

## Objective

Allow Aividi to generate images and videos with recurring characters that remain
recognizable across shots, revisions, and provider calls.

This scope turns the research summary in
[`docs/research/character-consistency-video.md`](../research/character-consistency-video.md)
into product and API work.

## Product Principles

- Character consistency is project data, not just prompt text.
- References should be explicit, reusable, and visible in the UI.
- The system should separate identity invariants from per-shot changes.
- Generated character assets should be traceable to the reference pack and
  prompt version that produced them.
- V1 should use hosted provider reference controls before introducing custom
  LoRA/DreamBooth training.

## Data Model Additions

```ts
interface CharacterProfile {
  id: string;
  projectId: string;
  name: string;
  description: string;
  identityInvariants: string;
  styleInvariants?: string;
  wardrobeInvariants?: string;
  negativePrompt?: string;
  status: "draft" | "ready" | "archived";
  createdAt: string;
  updatedAt: string;
}

interface CharacterReference {
  id: string;
  characterProfileId: string;
  assetId: string;
  role:
    | "front_portrait"
    | "three_quarter"
    | "profile"
    | "full_body"
    | "style"
    | "wardrobe"
    | "hero_frame";
  quality: "candidate" | "approved" | "rejected";
  notes?: string;
}

interface GeneratedAssetCharacterBinding {
  assetId: string;
  characterProfileId: string;
  referenceIds: string[];
  promptInvariantVersion: string;
  consistencyReview?: CharacterConsistencyReview;
}

interface CharacterConsistencyReview {
  identity: "pass" | "needs_review" | "fail";
  wardrobe: "pass" | "needs_review" | "fail";
  style: "pass" | "needs_review" | "fail";
  temporal?: "pass" | "needs_review" | "fail";
  notes?: string;
}
```

For the current local JSON MVP, these can live under the project object:

```ts
interface Project {
  characterProfiles?: CharacterProfile[];
  characterReferences?: CharacterReference[];
}
```

Hosted production should persist these as workspace/project-scoped rows.

## UI Scope

### Character Panel

Add a project-level character panel with:

- Create/edit/delete character profiles.
- Name and short description.
- Identity invariant text.
- Wardrobe/style invariant text.
- Negative prompt / avoid-list.
- Reference asset picker from uploaded/generated image assets.
- Reference role labels: front, three-quarter, profile, full-body, style,
  wardrobe, hero frame.
- Readiness indicator showing whether a profile has enough approved references.

### Asset Library Integration

On every image/video asset card:

- Allow "Use as character reference."
- Show which character profile the asset belongs to.
- Show whether the asset is a reference, generated output, or rejected candidate.
- Show consistency review status for generated character assets.

### Generation UI

For image/video generation:

- Let the user choose zero or more character profiles.
- Auto-fill the invariant prompt block into the generation request.
- Keep the shot prompt focused on the per-shot delta.
- Show which reference images will be passed to the provider.
- Warn if a selected character has too few references.

## API Scope

### Character Profiles

Future `/api/v1` routes:

- `POST /api/v1/projects/:projectId/characters`
- `GET /api/v1/projects/:projectId/characters`
- `GET /api/v1/projects/:projectId/characters/:characterId`
- `PATCH /api/v1/projects/:projectId/characters/:characterId`
- `DELETE /api/v1/projects/:projectId/characters/:characterId`

### Character References

- `POST /api/v1/projects/:projectId/characters/:characterId/references`
- `PATCH /api/v1/projects/:projectId/characters/:characterId/references/:referenceId`
- `DELETE /api/v1/projects/:projectId/characters/:characterId/references/:referenceId`

### Generated Asset Request Additions

Extend generated asset creation with character consistency fields:

```json
{
  "provider": "gemini",
  "kind": "video",
  "prompt": "She opens the old lab notebook and looks toward the petri dish.",
  "characterProfileIds": ["char_fleming"],
  "characterReferenceIds": ["ref_front", "ref_three_quarter", "ref_hero"],
  "consistencyMode": "reference_pack",
  "shotDelta": {
    "action": "opens the old lab notebook",
    "camera": "slow push-in",
    "setting": "1928 laboratory",
    "emotion": "curious realization"
  }
}
```

Suggested `consistencyMode` values:

- `prompt_only`: inject invariants, no image references.
- `reference_pack`: inject invariants and pass approved reference assets.
- `hero_frame`: use one hero frame as the primary reference.
- `first_frame_video`: use a selected frame as the first frame for video.
- `fine_tuned`: future mode for LoRA/DreamBooth/custom model workflows.

## Provider Adapter Scope

### Shared Prompt Builder

Add a helper that composes:

```text
[character identity invariants]
[style / wardrobe invariants]
[shot delta prompt]
[negative prompt / avoid-list]
```

All character-aware generation should use this helper instead of ad hoc string
concatenation.

### OpenAI Image Adapter

- Pass approved character references as multi-image edit inputs when available.
- Prefer edit/reference workflows for character-aware images after a hero image
  exists.
- Restate "do not redesign the character" invariants on every request.

### Gemini Image/Video Adapter

- For video, pass approved character image references into Veo where supported.
- Prefer a hero-frame or first-frame workflow for shot sequences.
- Keep clips short and assemble longer sequences through the timeline.

### Mock Provider

- Include character metadata in mock output so tests can verify request shape
  without calling live providers.

## Jobs And Processing

Character-aware generation should become a job because reference preparation,
provider generation, and QC may all be slow.

Job steps:

1. Resolve character profiles and approved references.
2. Validate references are local/copied assets available to the provider.
3. Build invariant prompt and provider-specific request.
4. Generate asset.
5. Save asset and bind it to the character profile.
6. Run lightweight consistency review checklist.
7. Return generated asset and review status.

## Quality Review

V1 manual review fields:

- identity
- wardrobe
- style
- temporal consistency for video
- notes

V2 automated review candidates:

- Face similarity against reference pack.
- CLIP/text alignment against shot delta.
- Perceptual similarity for protected reference regions.
- Temporal flicker / identity drift scoring for video.

## MVP Implementation Phases

### Phase 1: Data And Prompt Plumbing

- Add character profile/reference types to local project data.
- Add character-aware prompt builder.
- Add request fields to `POST /api/generate-assets`.
- Store character bindings on generated assets.
- Add docs and minimal tests around prompt/reference resolution.

### Phase 2: UI Character Reference Workflow

- Add character profile panel.
- Let users mark image assets as references.
- Let users choose character profiles during generation.
- Show generated asset consistency metadata.

### Phase 3: Provider Reference Support

- OpenAI image generation/edit references.
- Gemini/Veo image-reference support for videos.
- Provider-specific warnings when a requested mode is unsupported.

### Phase 4: Review And Regeneration

- Add manual consistency review.
- Add "regenerate with same character" action.
- Add "promote output to hero/reference" action.
- Add failed-review state that prevents weak reference images from polluting the
  profile.

## Acceptance Criteria

- A user can create a character profile and attach at least three approved
  reference images.
- A generated asset can be explicitly tied to one character profile.
- The generator can create a new image or video prompt using the profile's
  invariant block and references.
- Generated assets store which references and prompt invariant version were
  used.
- The UI can distinguish references, candidate outputs, and approved outputs.
- A user can mark a generated character asset as pass/fail for identity,
  wardrobe, style, and temporal consistency.
- Unsupported provider/reference combinations fail with clear messages instead
  of silently dropping consistency controls.

## Open Questions

- Should Aividi create character profiles manually only, or auto-suggest them
  from repeated people/subjects in uploaded clips?
- Should reference packs allow real people, fictional characters, products, and
  mascots under one model, or should there be separate profile types?
- Do we need consent/provenance fields for real-person likenesses in v1?
- Should background music, voice, and character consistency live in one unified
  "production bible" object, or remain separate feature areas?
- Which provider should be the first fully supported character-consistency
  target: OpenAI image editing, Gemini/Veo video, or both?
