defmodule Doodle.Repo do
  use Ecto.Repo,
    otp_app: :doodle,
    adapter: Ecto.Adapters.Postgres
end
