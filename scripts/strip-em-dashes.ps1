$files = @(
  'lib/post-settlement.ts',
  'lib/email-templates.ts',
  'lib/handover-email.ts',
  'lib/eod-briefs.ts',
  'lib/eow-briefs.ts',
  'lib/claude-drafts.ts',
  'lib/clients/claude.ts',
  'components/cx/AnniversaryActionRow.tsx'
)
$emdash = [char]0x2014
foreach ($f in $files) {
  $p = Resolve-Path -LiteralPath $f
  $c = Get-Content -Raw -LiteralPath $p
  if ($c -match $emdash) {
    $n = $c -replace $emdash, '-'
    Set-Content -LiteralPath $p -Value $n -NoNewline -Encoding utf8
    Write-Output ("updated: " + $f)
  } else {
    Write-Output ("no change: " + $f)
  }
}
