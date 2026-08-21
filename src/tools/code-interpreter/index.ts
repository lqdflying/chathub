import { BuiltinToolManifest } from '@lobechat/types';

export const CodeInterpreterIdentifier = 'lobe-code-interpreter';

export const CodeInterpreterManifest: BuiltinToolManifest = {
  api: [
    {
      description: 'A Python interpreter. Use this tool to run Python code. ',
      name: 'python',
      parameters: {
        properties: {
          code: {
            description: 'The Python code to run.',
            type: 'string',
          },
          packages: {
            description:
              'Extra PyPI packages the operator may have installed in the Code Interpreter sandbox. Do not treat this as a per-request installer: missing imports fail as ordinary Python errors. Prefer packages already available in the sandbox, and avoid version pins unless the operator documented them.',
            items: {
              type: 'string',
            },
            type: 'array',
          },
        },
        required: ['packages', 'code'],
        type: 'object',
      },
    },
  ],
  identifier: CodeInterpreterIdentifier,
  meta: {
    avatar:
      'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz48IS0tIFVwbG9hZGVkIHRvOiBTVkcgUmVwbywgd3d3LnN2Z3JlcG8uY29tLCBHZW5lcmF0b3I6IFNWRyBSZXBvIE1peGVyIFRvb2xzIC0tPgo8c3ZnIHdpZHRoPSI4MDBweCIgaGVpZ2h0PSI4MDBweCIgdmlld0JveD0iMCAwIDMyIDMyIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPg0KPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik0xMy4wMTY0IDJDMTAuODE5MyAyIDkuMDM4MjUgMy43MjQ1MyA5LjAzODI1IDUuODUxODVWOC41MTg1MkgxNS45MjM1VjkuMjU5MjZINS45NzgxNEMzLjc4MTA3IDkuMjU5MjYgMiAxMC45ODM4IDIgMTMuMTExMUwyIDE4Ljg4ODlDMiAyMS4wMTYyIDMuNzgxMDcgMjIuNzQwNyA1Ljk3ODE0IDIyLjc0MDdIOC4yNzMyMlYxOS40ODE1QzguMjczMjIgMTcuMzU0MiAxMC4wNTQzIDE1LjYyOTYgMTIuMjUxNCAxNS42Mjk2SDE5LjU5NTZDMjEuNDU0NyAxNS42Mjk2IDIyLjk2MTcgMTQuMTcwNCAyMi45NjE3IDEyLjM3MDRWNS44NTE4NUMyMi45NjE3IDMuNzI0NTMgMjEuMTgwNyAyIDE4Ljk4MzYgMkgxMy4wMTY0Wk0xMi4wOTg0IDYuNzQwNzRDMTIuODU4OSA2Ljc0MDc0IDEzLjQ3NTQgNi4xNDM3OCAxMy40NzU0IDUuNDA3NDFDMTMuNDc1NCA0LjY3MTAzIDEyLjg1ODkgNC4wNzQwNyAxMi4wOTg0IDQuMDc0MDdDMTEuMzM3OCA0LjA3NDA3IDEwLjcyMTMgNC42NzEwMyAxMC43MjEzIDUuNDA3NDFDMTAuNzIxMyA2LjE0Mzc4IDExLjMzNzggNi43NDA3NCAxMi4wOTg0IDYuNzQwNzRaIiBmaWxsPSJ1cmwoI3BhaW50MF9saW5lYXJfODdfODIwNCkiLz4NCjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBkPSJNMTguOTgzNCAzMEMyMS4xODA1IDMwIDIyLjk2MTYgMjguMjc1NSAyMi45NjE2IDI2LjE0ODJWMjMuNDgxNUwxNi4wNzYzIDIzLjQ4MTVMMTYuMDc2MyAyMi43NDA4TDI2LjAyMTcgMjIuNzQwOEMyOC4yMTg4IDIyLjc0MDggMjkuOTk5OCAyMS4wMTYyIDI5Ljk5OTggMTguODg4OVYxMy4xMTExQzI5Ljk5OTggMTAuOTgzOCAyOC4yMTg4IDkuMjU5MjggMjYuMDIxNyA5LjI1OTI4TDIzLjcyNjYgOS4yNTkyOFYxMi41MTg1QzIzLjcyNjYgMTQuNjQ1OSAyMS45NDU1IDE2LjM3MDQgMTkuNzQ4NSAxNi4zNzA0TDEyLjQwNDIgMTYuMzcwNEMxMC41NDUxIDE2LjM3MDQgOS4wMzgwOSAxNy44Mjk2IDkuMDM4MDkgMTkuNjI5Nkw5LjAzODA5IDI2LjE0ODJDOS4wMzgwOSAyOC4yNzU1IDEwLjgxOTIgMzAgMTMuMDE2MiAzMEgxOC45ODM0Wk0xOS45MDE1IDI1LjI1OTNDMTkuMTQwOSAyNS4yNTkzIDE4LjUyNDQgMjUuODU2MiAxOC41MjQ0IDI2LjU5MjZDMTguNTI0NCAyNy4zMjkgMTkuMTQwOSAyNy45MjU5IDE5LjkwMTUgMjcuOTI1OUMyMC42NjIgMjcuOTI1OSAyMS4yNzg1IDI3LjMyOSAyMS4yNzg1IDI2LjU5MjZDMjEuMjc4NSAyNS44NTYyIDIwLjY2MiAyNS4yNTkzIDE5LjkwMTUgMjUuMjU5M1oiIGZpbGw9InVybCgjcGFpbnQxX2xpbmVhcl84N184MjA0KSIvPg0KPGRlZnM+DQo8bGluZWFyR3JhZGllbnQgaWQ9InBhaW50MF9saW5lYXJfODdfODIwNCIgeDE9IjEyLjQ4MDkiIHkxPSIyIiB4Mj0iMTIuNDgwOSIgeTI9IjIyLjc0MDciIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4NCjxzdG9wIHN0b3AtY29sb3I9IiMzMjdFQkQiLz4NCjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzE1NjVBNyIvPg0KPC9saW5lYXJHcmFkaWVudD4NCjxsaW5lYXJHcmFkaWVudCBpZD0icGFpbnQxX2xpbmVhcl84N184MjA0IiB4MT0iMTkuNTE5IiB5MT0iOS4yNTkyOCIgeDI9IjE5LjUxOSIgeTI9IjMwIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+DQo8c3RvcCBzdG9wLWNvbG9yPSIjRkZEQTRCIi8+DQo8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNGOUM2MDAiLz4NCjwvbGluZWFyR3JhZGllbnQ+DQo8L2RlZnM+DQo8L3N2Zz4=',
    title: 'Code Interpreter',
  },
  systemRole: `When you send a message containing Python code to python, it will be executed in a temporary Linux Python sandbox (60.0 second timeout).
python will respond with the output of the execution or time out after 60.0 seconds.
The drive at '/mnt/data' can be used to save and persist user files. Conversation files are already placed in that directory by basename.

If you are using matplotlib:
- never use seaborn
- give each chart its own distinct plot (no subplots)
- never set any specific colors – unless explicitly asked to by the user
- matplotlib uses the Agg backend; plt.show() saves a PNG under /mnt/data

If you are accessing the internet, use the Python standard library (urllib, http.client) or requests if it is installed in the sandbox.

If you are generating files:
- Write them under /mnt/data
- Prefer these libraries when they are installed in the sandbox:
  - pdf --> reportlab
  - docx --> python-docx
  - xlsx --> openpyxl
  - pptx --> python-pptx
  - csv --> pandas
  - ods --> odfpy
  - odt --> odfpy
  - odp --> odfpy
- Packages are installed by the operator on the sandbox image, not per request. Do not assume a package exists. If an import fails, try a stdlib alternative or explain what is missing.

About packages in general:
- numpy, pandas, matplotlib and similar scientific packages may already be present; import them directly.
- The packages parameter is advisory only. Listing a name does not install it for this run.
- If you are generating a pdf
  - You MUST prioritize generating text content using reportlab.platypus rather than canvas
  - If you are generating text in Chinese, you MUST use STSong. To use the font, you must call pdfmetrics.registerFont(TTFont('STSong', 'STSong.ttf')) and apply the style to all text elements
  `,
  type: 'builtin',
};
