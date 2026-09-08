import json
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse, HTMLResponse
from pydantic import BaseModel

from lichess.player import play_encoded_game
from steg.decoder import decode_from_game_id
from lichess.api import parse_game_id

app = FastAPI()


@app.get("/", response_class=HTMLResponse)
async def index():
    return Path("templates/index.html").read_text(encoding="utf-8")


class EncodeRequest(BaseModel):
    message: str
    password: str
    opponent: str = ""


class DecodeRequest(BaseModel):
    game_input: str
    password: str


@app.post("/encode")
async def encode(req: EncodeRequest):
    async def event_stream():
        async for event in play_encoded_game(
            req.message, req.password, req.opponent.strip() or None
        ):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/decode")
async def decode(req: DecodeRequest):
    try:
        game_id = parse_game_id(req.game_input)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    moves_log: list[dict] = []

    def on_move(info: dict):
        moves_log.append(info)

    try:
        plaintext = await decode_from_game_id(game_id, req.password, on_move)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {"plaintext": plaintext, "moves": moves_log}
